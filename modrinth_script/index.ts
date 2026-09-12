import * as fs from "node:fs";
import * as path from "node:path";
import * as jstoml from "js-toml";
import axiosRetry from "axios-retry";
import axios from "axios";
import * as child_process from "node:child_process";

const api = axios.create({
  baseURL: "https://api.modrinth.com/v2/",
  headers: {
    "User-Agent": "alexkar598/temp_script",
  },
});

axiosRetry(api, {
  retries: 3,
  // Retry only if the server responds with a 429 Too Many Requests status
  retryCondition: (error) => {
    return (error.response && error.response.status === 429) ?? false;
  },
  // Automatically calculate delay based on the server's 'retry-after' header
  retryDelay: (retryCount, error) => {
    const retryAfter = error.response?.headers["X-Ratelimit-Reset"];
    if (retryAfter) {
      // Note: 'retry-after' is usually in seconds; axios-retry expects milliseconds
      return parseInt(retryAfter, 10) * 1000;
    }
    // Fallback delay if header is missing
    return 2000;
  },
});

for (const mod of fs.readdirSync("mods", { withFileTypes: true })) {
  if (!mod.isFile()) continue;

  const mod_manifest_raw = fs.readFileSync(
    path.join(mod.parentPath, mod.name),
    "utf8",
  );
  const mod_manifest = jstoml.load(mod_manifest_raw) as any;

  if (!("curseforge" in mod_manifest.update)) {
    // console.log("File is already processed.");
    continue;
  }
  console.log(
    `\n=============\nProcessing ${mod_manifest.name}\n=============`,
  );

  const { data: search_results } = await api.get(
    `search?facets=[["categories:neoforge"],["versions:1.21.1"],["project_type:mod"]]&query=${encodeURIComponent(mod_manifest.name)}`,
  );
  const project = search_results.hits[0];
  if (project == null) {
    console.warn("Could not find mod");
    continue;
  }
  const project_id = project.project_id as string;
  console.log(
    `[${project_id}] Found ${project.title} (${project.description}) - ${project.downloads} downloads`,
  );

  const { data: version_results } = await api.get(
    `project/${encodeURIComponent(project_id)}/version?loaders=["neoforge"]&game_versions=["1.21.1"]&include_changelog=false`,
  );

  const version = (version_results as any[]).find((version) => {
    return (version.files as any[]).some((file) => {
      return file.filename == mod_manifest.filename;
    });
  });
  if (version == null) {
    console.warn("Could not find version");
    continue;
  }
  const version_id = version.id;

  console.log(
    `[${version_id}] Found version ${version.name} - ${version.downloads} downloads`,
  );

  child_process.execFileSync(
    "packwiz",
    [
      "modrinth",
      "add",
      "--project-id",
      project_id,
      "--version-id",
      version_id,
      "--yes",
    ],
    { stdio: "inherit" },
  );
}

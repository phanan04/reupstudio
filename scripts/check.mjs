import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "../server/runtime.mjs";
for (const dir of ["server", "public", "scripts", "tests"]) {
  for (const name of fs.readdirSync(path.join(projectRoot, dir))) {
    if (!/\.(mjs|js)$/.test(name)) continue;
    const result = spawnSync(process.execPath, ["--check", path.join(projectRoot, dir, name)], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log("JavaScript syntax OK.");

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "../server/runtime.mjs";
const files = fs.readdirSync(path.join(projectRoot, "tests")).filter(f => f.endsWith(".test.mjs")).sort().map(f => path.join(projectRoot, "tests", f));
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: projectRoot, stdio: "inherit", env: { ...process.env, VIETSTUDIO_ENV_FILE: "" },
});
process.exit(result.status ?? 1);

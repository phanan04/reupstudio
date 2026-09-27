import { spawnSync } from "node:child_process";
import { projectRoot } from "../server/runtime.mjs";
for (const [key, value] of [["pull.ff", "only"], ["fetch.prune", "true"], ["push.default", "simple"]]) {
  const result = spawnSync("git", ["config", "--local", key, value], { cwd: projectRoot, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("Git: pull chỉ fast-forward; không tự merge/rebase. Cấu hình chỉ áp dụng repository này.");

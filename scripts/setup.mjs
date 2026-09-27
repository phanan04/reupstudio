import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvironment } from "../server/runtime.mjs";
import { markPythonDependencies } from "./python-deps.mjs";
import { assertDataIdle } from "../server/data-lock.mjs";
import { dataDirectory } from "../server/runtime.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
loadEnvironment(root);
assertDataIdle(dataDirectory());
if (Number(process.versions.node.split(".")[0]) < 24)
  throw Error("Cần Node.js 24 trở lên.");
const python = process.env.PYTHON || process.argv.slice(2).find(a => !a.startsWith("--")) || (process.platform === "win32" ? "python" : "python3");
const exec = (bin, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(bin, args, {
      cwd: root,
      windowsHide: true,
      stdio: "inherit",
      shell: false,
    });
    p.once("error", reject);
    p.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`${bin} failed: ${code}`)),
    );
  });
await exec(python, [
  "-c",
  'import sys; assert sys.version_info[:2] == (3,12), "Use Python 3.12 for the tested lockfile"',
]);
await exec(python, ["-m", "venv", ".venv"]);
const venv = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
await exec(venv, ["-m", "pip", "install", "-r", "requirements.lock.txt"]);
await exec(venv, ["-m", "pip", "check"]);
markPythonDependencies();
if (process.argv.includes("--dependencies-only")) process.exit(0);
await exec(venv, ["scripts/install-assets.py"]);
await exec(venv, ["scripts/install-opus.py"]);
console.log("Tài nguyên đã cài. Chạy npm start. Với DB cũ, dừng server rồi chạy node scripts/configure-local.mjs để cập nhật đường dẫn.");

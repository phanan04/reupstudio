import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) < 24)
  throw Error("Cần Node.js 24 trở lên.");
const python = process.env.PYTHON || process.argv[2] || "python";
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
const venv = path.join(root, ".venv", "Scripts", "python.exe");
await exec(venv, ["-m", "pip", "install", "-r", "requirements.lock.txt"]);
await exec(venv, ["scripts/install-assets.py"]);
await exec(venv, ["scripts/install-opus.py"]);
await exec(process.execPath, ["scripts/configure-local.mjs", "--cpu"]);
fs.writeFileSync(
  path.join(root, "runtime-path.txt"),
  process.execPath + os.EOL,
);
console.log("Cài xong. Chạy Start.cmd rồi mở http://127.0.0.1:8765");

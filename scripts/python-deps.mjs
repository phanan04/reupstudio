import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { projectRoot as root } from "../server/runtime.mjs";

export const venvPython = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const marker = path.join(root, ".venv", "vietstudio-dependencies.sha256");
const fingerprint = () => createHash("sha256").update(fs.readFileSync(path.join(root, "requirements.lock.txt"))).update(process.platform + process.arch).digest("hex");
export function markPythonDependencies() { fs.writeFileSync(marker, fingerprint()); }
export async function syncPythonDependencies() {
  if (!fs.existsSync(venvPython)) return; // SRT/Ollama editing does not require Python.
  if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === fingerprint()) return;
  console.log("Đồng bộ dependencies Python theo lockfile...");
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(venvPython, args, { cwd: root, stdio: "inherit", shell: false, windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(Error("Không thể đồng bộ Python. Kiểm tra Python 3.12 và kết nối mạng; chưa mở DB.")));
  });
  await run(["-m", "pip", "install", "-r", "requirements.lock.txt"]);
  await run(["-m", "pip", "check"]);
  markPythonDependencies();
}

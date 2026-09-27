import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(path.dirname(root), "vietstudio-transfer");
await fs.mkdir(target, { recursive: true });
for (const name of [
  "server",
  "public",
  "workers",
  "scripts",
  "tests",
  "README.md",
  "AGENTS.md",
  "PROGRESS.md",
  "ARCHITECTURE.md",
  "TEST-REPORT.md",
  "TRANSLATION.md",
  "TRANSLATION-QUALITY.md",
  "requirements.lock.txt",
  "requirements-opus.lock.txt",
  "package.json",
  "package-lock.json",
  ".env.example",
  ".node-version",
  ".python-version",
  ".gitattributes",
  ".dockerignore",
  "compose.yaml",
  "docker",
  "docs",
  "Start.cmd",
  "Start.command",
  "Setup.cmd",
  ".gitignore",
])
  await fs.cp(path.join(root, name), path.join(target, name), {
    recursive: true,
  });
if (process.argv.includes("--with-models")) {
  await fs.cp(path.join(root, "models"), path.join(target, "models"), {
    recursive: true,
  });
  await fs.cp(path.join(root, "tools"), path.join(target, "tools"), {
    recursive: true,
    filter: (source) =>
      !source.endsWith(".blocked.json") &&
      !source.endsWith(".part") &&
      !source.endsWith(".zip"),
  });
}
console.log(
  "Transfer folder: " +
    target +
    "\nNo personal projects, cookies, or virtual environment copied. Tools are OS-specific; run npm run setup on the target machine.",
);

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
  "ARCHITECTURE.md",
  "TEST-REPORT.md",
  "TRANSLATION.md",
  "TRANSLATION-QUALITY.md",
  "requirements.lock.txt",
  "package.json",
  "Start.cmd",
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
    "\nNo personal projects, cookies, or virtual environment copied. Run Setup.cmd on the target PC.",
);

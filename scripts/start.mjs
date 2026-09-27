import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawn, spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) < 24)
  throw Error("Việt Studio cần Node.js 24 trở lên.");
if (!fs.existsSync(path.join(root, "data/studio.sqlite")))
  await import("./configure-local.mjs");
const db = new DatabaseSync(path.join(root, "data/studio.sqlite"));
const config = JSON.parse(
  db.prepare("SELECT data FROM settings WHERE id=1").get().data,
);
db.close();
if (
  config.translationEngine === "ollama" &&
  config.ollamaUrl === "http://127.0.0.1:11434"
) {
  let online = false;
  try {
    online = (
      await fetch(config.ollamaUrl + "/api/tags", {
        signal: AbortSignal.timeout(1500),
      })
    ).ok;
  } catch {}
  const binary = path.join(root, "tools/ollama-local/ollama.exe");
  if (!online && fs.existsSync(binary)) {
    const log = fs.openSync(path.join(root, "data/ollama-runtime.log"), "a");
    const child = spawn(binary, ["serve"], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_MODELS: path.join(root, "models/ollama"),
        OLLAMA_NO_CLOUD: "1",
        OLLAMA_NUM_PARALLEL: "1",
        OLLAMA_MAX_LOADED_MODELS: "1",
      },
    });
    child.on("error", (e) => console.error("Ollama: " + e.message));
    process.once("exit", () => {
      if (child.exitCode === null && child.pid) {
        if (process.platform === "win32")
          spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        else child.kill();
      }
      fs.closeSync(log);
    });
    console.log("Đang mở Ollama local. Nhật ký: data/ollama-runtime.log");
  }
}
await import("../server/main.mjs");

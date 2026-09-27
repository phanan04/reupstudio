import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { DatabaseSync } from "node:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { projectRoot as root, loadEnvironment, dataDirectory, localDefaults } from "../server/runtime.mjs";
import { defaults } from "../server/store.mjs";
import { assertDataIdle } from "../server/data-lock.mjs";
import { syncPythonDependencies } from "./python-deps.mjs";

if (Number(process.versions.node.split(".")[0]) < 24) throw Error("Việt Studio cần Node.js 24 trở lên.");
process.chdir(root);
loadEnvironment();
const port = Number(process.env.PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("PORT phải từ 1 đến 65535.");
// Check before opening Store: its constructor marks interrupted jobs.
const occupied = await new Promise(resolve => {
  const socket = net.connect(port, "127.0.0.1");
  socket.setTimeout(1000);
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
  socket.once("timeout", () => { socket.destroy(); resolve(false); });
});
if (occupied) throw Error(`Cổng ${port} đang được dùng. Giữ server hiện tại hoặc chọn PORT khác và thư mục dữ liệu riêng.`);
const data = dataDirectory();
assertDataIdle(data);
await syncPythonDependencies();
let config = { ...defaults, ...localDefaults() };
const database = path.join(data, "studio.sqlite");
if (fs.existsSync(database)) {
  const db = new DatabaseSync(database, { readOnly: true });
  try { config = { ...config, ...JSON.parse(db.prepare("SELECT data FROM settings WHERE id=1").get().data) }; }
  finally { db.close(); }
}
if (config.translationEngine === "ollama" && config.ollamaUrl === "http://127.0.0.1:11434") {
  const online = async () => {
    try { return (await fetch(config.ollamaUrl + "/api/tags", { signal: AbortSignal.timeout(1500) })).ok; }
    catch { return false; }
  };
  if (!await online()) {
    const portable = path.join(root, "tools/ollama-local", process.platform === "win32" ? "ollama.exe" : "ollama");
    const binary = process.env.VIETSTUDIO_OLLAMA_BIN || (fs.existsSync(portable) ? portable : "ollama");
    fs.mkdirSync(data, { recursive: true });
    const log = fs.openSync(path.join(data, "ollama-runtime.log"), "a");
    const child = spawn(binary, ["serve"], {
      cwd: root, windowsHide: true, stdio: ["ignore", log, log],
      env: { ...process.env, OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_MODELS: path.resolve(root, process.env.OLLAMA_MODELS || "models/ollama"),
        OLLAMA_NO_CLOUD: "1", OLLAMA_NUM_PARALLEL: "1", OLLAMA_MAX_LOADED_MODELS: "1" },
    });
    let failed = false;
    child.on("error", () => { failed = true; });
    child.on("exit", () => { failed = true; });
    process.once("exit", () => {
      if (child.exitCode === null && child.pid) {
        if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else child.kill();
      }
      fs.closeSync(log);
    });
    let ready = false;
    for (let i = 0; i < 30 && !failed; i++) {
      if (await online()) { ready = true; break; }
      await delay(500);
    }
    if (!ready) console.warn("Ollama chưa sẵn sàng. Vẫn mở trình biên tập; cài/mở Ollama trước khi dịch. Xem ollama-runtime.log trong thư mục dữ liệu.");
  }
}
await import("../server/main.mjs");

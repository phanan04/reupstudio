import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = new Store(path.join(root, "data"));
const find = (dir, name) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return file;
    if (entry.isDirectory()) {
      const found = find(file, name);
      if (found) return found;
    }
  }
  return "";
};
store.saveSettings({
  ...store.settings(),
  ffmpeg: path.join(root, "tools/ffmpeg/ffmpeg.exe"),
  ffprobe: path.join(root, "tools/ffmpeg/ffprobe.exe"),
  python: path.join(root, ".venv/Scripts/python.exe"),
  ytdlp: path.join(root, ".venv/Scripts/yt-dlp.exe"),
  whisper: find(path.join(root, "tools/whisper"), "whisper-cli.exe"),
  whisperModel: path.join(root, "models/ggml-small.bin"),
  voicesDir: path.join(root, "models/voices"),
  llama: find(path.join(root, "tools/llama"), "llama-server.exe"),
  llamaModel: path.join(root, "models/Qwen3-4B-Q4_K_M.gguf"),
  llmModel: "qwen3-4b",
  opusModel: path.join(root, "models/opus-zh-vi"),
  managedLlm: true,
});
if (process.argv.includes("--cpu"))
  store.saveSettings({
    ...store.settings(),
    translationEngine:
      fs.existsSync(path.join(root, "tools/ollama-local/ollama.exe")) &&
      fs.existsSync(
        path.join(
          root,
          "models/ollama/manifests/registry.ollama.ai/library/qwen3/4b-instruct",
        ),
      )
        ? "ollama"
        : "opus",
    forceCpu: true,
    batchSize: 4,
    contextSize: 4096,
  });
store.close();
console.log("Local tool paths configured.");

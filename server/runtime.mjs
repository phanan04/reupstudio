import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaries = ["ffmpeg", "ffprobe", "python", "ytdlp", "whisper", "llama"];
const resources = ["whisperVadModel", "whisperModel", "llamaModel", "opusModel", "voicesDir", "cookies"];

export function loadEnvironment(root = projectRoot) {
  // Empty value disables .env loading for isolated tests and CI.
  const file = process.env.VIETSTUDIO_ENV_FILE ?? ".env";
  if (file && fs.existsSync(path.resolve(root, file))) process.loadEnvFile(path.resolve(root, file));
}

export function dataDirectory(root = projectRoot) {
  return path.resolve(root, process.env.VIETSTUDIO_DATA || "data");
}

export function findTool(dir, name) {
  if (!fs.existsSync(dir)) return "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if ((entry.isFile() || (entry.isSymbolicLink() && fs.statSync(file).isFile())) && entry.name === name) return file;
    if (entry.isDirectory()) {
      const found = findTool(file, name);
      if (found) return found;
    }
  }
  return "";
}

export function portableSettings(settings, root = projectRoot) {
  const result = { ...settings };
  for (const key of [...binaries, ...resources]) {
    const value = result[key];
    if (!value || !path.isAbsolute(value)) continue;
    const relative = path.relative(root, value);
    if (relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
      result[key] = "./" + relative.split(path.sep).join("/");
  }
  return result;
}

export function localDefaults(root = projectRoot, platform = process.platform) {
  const win = platform === "win32", suffix = win ? ".exe" : "";
  const bundled = (dir, name, fallback) => findTool(path.join(root, dir), name) || fallback;
  return portableSettings({
    translationEngine: "ollama", batchSize: 4, contextSize: 4096,
    ffmpeg: bundled("tools/ffmpeg", "ffmpeg" + suffix, "ffmpeg"),
    ffprobe: bundled("tools/ffmpeg", "ffprobe" + suffix, "ffprobe"),
    python: bundled(win ? ".venv/Scripts" : ".venv/bin", "python" + suffix, win ? "python" : "python3"),
    ytdlp: bundled(win ? ".venv/Scripts" : ".venv/bin", "yt-dlp" + suffix, "yt-dlp"),
    whisper: bundled("tools/whisper", "whisper-cli" + suffix, "whisper-cli"),
    llama: bundled("tools/llama", "llama-server" + suffix, "llama-server"),
    whisperModel: "./models/ggml-small.bin", voicesDir: "./models/voices",
    llamaModel: "./models/Qwen3-4B-Q4_K_M.gguf", opusModel: "./models/opus-zh-vi",
  }, root);
}

export function runtimeSettings(settings, root = projectRoot) {
  const result = { ...settings };
  const detected = localDefaults(root);
  const conventional = { ffmpeg: ["ffmpeg"], ffprobe: ["ffprobe"], python: ["python", "python3"],
    ytdlp: ["yt-dlp"], whisper: ["whisper-cli"], llama: ["llama-server"] };
  for (const key of binaries)
    if (conventional[key].includes(result[key])) result[key] = detected[key];
  for (const key of [...binaries, ...resources]) {
    const value = result[key];
    if (!value) continue;
    // Bare executable names use PATH; all resource paths are relative to the repo,
    // never to an episode's working directory.
    if (resources.includes(key) || /[/\\]/.test(value))
      result[key] = path.resolve(root, value);
    else if (key === "llama") {
      // llama.cpp's existing preflight checks require an existing file.
      for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        const candidate = path.join(dir, value + (process.platform === "win32" && !value.endsWith(".exe") ? ".exe" : ""));
        if (fs.existsSync(candidate)) { result[key] = candidate; break; }
      }
    }
  }
  return result;
}

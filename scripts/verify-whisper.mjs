import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { run, parseSubtitles } from "../server/core.mjs";
const dir = path.resolve("data/verification/whisper");
await fs.mkdir(dir, { recursive: true });
const url =
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/samples/speaker_0.mp3";
const response = await fetch(url);
if (!response.ok) throw Error("Cannot download speech fixture");
const data = Buffer.from(await response.arrayBuffer());
if (
  createHash("sha256").update(data).digest("hex") !==
  "1c56ade3438fd24f7c4ca0e9794eaa4e0f03b0f5f9859b159a07fcff0bad8322"
)
  throw Error("Speech fixture checksum mismatch");
await fs.writeFile(path.join(dir, "chinese.mp3"), data);
const c = await (await fetch("http://127.0.0.1:8765/api/settings")).json();
await run(
  c.ffmpeg,
  ["-y", "-i", "chinese.mp3", "-ar", "16000", "-ac", "1", "speech.wav"],
  { cwd: dir },
);
await run(
  c.whisper,
  [
    "-m",
    c.whisperModel,
    "-f",
    "speech.wav",
    "-l",
    "zh",
    "-osrt",
    "-of",
    "recognized",
    "-t",
    "4",
  ],
  { cwd: dir, timeout: 300000 },
);
const cues = parseSubtitles(
  await fs.readFile(path.join(dir, "recognized.srt"), "utf8"),
);
if (!cues.some((q) => /[\u3400-\u9fff]/.test(q.text)))
  throw Error("No Chinese transcription");
console.log(JSON.stringify({ status: "passed", cues, source: url }, null, 2));

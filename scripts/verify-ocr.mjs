import fs from "node:fs/promises";
import path from "node:path";
import { run, parseSubtitles } from "../server/core.mjs";
const latest = JSON.parse(
  await fs.readFile("data/verification/latest.json", "utf8"),
);
const c = await (await fetch("http://127.0.0.1:8765/api/settings")).json();
await run(
  c.python,
  [
    path.resolve("workers/ocr.py"),
    "--input",
    path.join(latest.work, "source.mp4"),
    "--output",
    path.join(latest.work, "ocr-check.json"),
    "--roi",
    "0,72,100,25",
    "--fps",
    "2",
  ],
  { timeout: 180000 },
);
const cues = parseSubtitles(
  await fs.readFile(path.join(latest.work, "ocr-check.json"), "utf8"),
);
console.log(
  JSON.stringify(
    { count: cues.length, text: cues.map((c) => c.text), path: latest.work },
    null,
    2,
  ),
);
if (!cues.some((c) => c.text.includes("今天")))
  throw Error("Expected Chinese subtitle not detected");
await run(c.ffmpeg, [
  "-y",
  "-ss",
  "2",
  "-i",
  path.join(latest.work, "output.mp4"),
  "-frames:v",
  "1",
  path.resolve("data/verification/output-frame.png"),
]);

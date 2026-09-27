import fs from "node:fs/promises";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { srt } from "../server/core.mjs";
const root = process.cwd(),
  latest = JSON.parse(
    await fs.readFile("data/verification/latest.json", "utf8"),
  );
const c = await (await fetch("http://127.0.0.1:8765/api/settings")).json();
c.translationEngine = "opus";
c.opusModel = path.join(root, "models/opus-zh-vi");
const db = new Store(path.join(root, "data/e2e-verification"));
db.saveSettings(c);
const p = new Pipeline(db, root),
  s = db.listSeries()[0];
db.updateSeries(s.id, "Kiểm thử toàn trình", {
  ...s.options,
  review: false,
  cover: "box",
  outputHeight: 480,
});
const e = db.addEpisode(s.id, {
    title: "Phụ đề Trung → dịch CPU → giọng Việt → MP4",
    source: "source.mp4",
  }),
  dir = db.episodeDir(e.id);
await fs.copyFile(
  path.join(latest.work, "source.mp4"),
  path.join(dir, "source.mp4"),
);
await fs.writeFile(
  path.join(dir, "source.zh.srt"),
  srt([
    { start: 0.5, end: 4.8, text: "你好，欢迎来到我们的频道。" },
    { start: 5.3, end: 9.5, text: "今天我们一起学习新的知识。" },
    { start: 10, end: 14.8, text: "谢谢观看，我们下次再见。" },
  ]),
);
try {
  await p.process({ id: e.id, mode: "all" }, new AbortController().signal);
  const result = db.episode(e.id);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        cues: result.cues,
        output: path.join(dir, "output.mp4"),
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(root, "data/e2e-verification/result.json"),
    JSON.stringify(result, null, 2),
  );
} finally {
  db.close();
}

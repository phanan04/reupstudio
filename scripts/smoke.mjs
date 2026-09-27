import fs from "node:fs/promises";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
import { run, ass } from "../server/core.mjs";
const root = process.cwd(),
  dir = path.join(root, "data", "verification");
await fs.mkdir(dir, { recursive: true });
const config = await (await fetch("http://127.0.0.1:8765/api/settings")).json();
const store = new Store(dir),
  p = new Pipeline(store, root),
  s = store.listSeries()[0];
store.saveSettings(config);
const cues = [
  {
    id: "1",
    start: 0.5,
    end: 4.8,
    text: "你好，欢迎来到我们的频道。",
    vi: "Xin chào, chào mừng bạn đến với kênh của chúng tôi.",
    voice: "vi_VN-vais1000-medium",
  },
  {
    id: "2",
    start: 5.3,
    end: 9.5,
    text: "今天我们一起学习新的知识。",
    vi: "Hôm nay, chúng ta cùng học những kiến thức mới.",
    voice: "vi_VN-vivos-x_low",
  },
  {
    id: "3",
    start: 10,
    end: 14.8,
    text: "谢谢观看，我们下次再见。",
    vi: "Cảm ơn bạn đã xem. Hẹn gặp lại lần sau.",
    voice: "vi_VN-25hours_single-low",
  },
];
const e = store.addEpisode(s.id, {
  title: "Kiểm thử xuất thật · 3 giọng Việt",
  source: "source.mp4",
  cues,
  manualCues: true,
});
const work = store.episodeDir(e.id);
await fs.writeFile(
  path.join(work, "chinese.ass"),
  ass(cues.map((c) => ({ ...c, vi: c.text }))).replace(
    "Arial",
    "Microsoft YaHei",
  ),
);
await run(
  config.ffmpeg,
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24:duration=16",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=24000:duration=16",
    "-vf",
    "ass=chinese.ass",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "source.mp4",
  ],
  { cwd: work },
);
store.updateSeries(s.id, s.title, {
  ...s.options,
  cover: "blur",
  outputHeight: 480,
  review: false,
  originalVolume: 0.06,
});
try {
  await p.process({ id: e.id, mode: "render" }, new AbortController().signal);
  const out = await p.probe(path.join(work, "output.mp4"), config);
  console.log(
    JSON.stringify(
      {
        status: store.episode(e.id).status,
        output: path.join(work, "output.mp4"),
        duration: out.format.duration,
        streams: out.streams.map((s) => ({
          type: s.codec_type,
          codec: s.codec_name,
          width: s.width,
          height: s.height,
        })),
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(dir, "latest.json"),
    JSON.stringify(
      { id: e.id, work, output: path.join(work, "output.mp4") },
      null,
      2,
    ),
  );
} finally {
  store.close();
}

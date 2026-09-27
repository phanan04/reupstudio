import fs from "node:fs/promises";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { validateCues } from "../server/core.mjs";
import { putKnowledge } from "../server/knowledge.mjs";
import { translateContext, reviewTranslation } from "../server/translation.mjs";
import { translateOpus } from "../server/opus.mjs";
const root = process.cwd(),
  folder = path.join(root, "data", "context-evaluation");
const store = new Store(folder),
  series = store.createSeries(
    "Đánh giá ngữ cảnh · " + new Date().toISOString(),
  );
const config = {
  ...(await (await fetch("http://127.0.0.1:8765/api/settings")).json()),
  translationEngine: "ollama",
  ollamaModel: process.env.EVAL_MODEL || "vietstudio-qwen3:4b",
  forceCpu: true,
  batchSize: 4,
  contextSize: 4096,
  autoReview: false,
};
const inputs = [
  ["姐姐，我不是故意的。", "em", "chi", "Em xin lỗi chị, không cố ý."],
  ["你别怕，姐姐会保护你。", "chi", "em", "Chị trấn an em gái."],
  ["沈总，请您过目。", "employee", "boss", "Nhân viên trình tài liệu cho sếp."],
  [
    "他是她心中的白月光。",
    "",
    "",
    "Tình yêu lý tưởng khó quên, không phải mặt trăng vật lý.",
  ],
  [
    "一月休两天太坑了。",
    "worker",
    "peer",
    "Nhân viên nhà hàng đang phàn nàn lịch nghỉ mỗi tháng.",
  ],
  [
    "我们服务员为啥不行呢？",
    "worker",
    "peer",
    "Nhân viên muốn được nghỉ cuối tuần như nghề khác.",
  ],
  [
    "不给双休咱就不干了。",
    "worker",
    "peer",
    "Nhân viên phản đối việc không được nghỉ hai ngày cuối tuần.",
  ],
  [
    "我没有说她偷了钱。",
    "worker",
    "peer",
    "Giữ đúng phủ định: tôi không nói cô ấy lấy tiền.",
  ],
];
const input = validateCues(
  inputs.map(([text, speaker, listener, scene], i) => ({
    start: i * 4 + 0.12,
    end: i * 4 + 3.89,
    text,
    vi: "",
    speaker,
    listener,
    scene,
  })),
);
putKnowledge(
  store,
  series.id,
  {
    synopsis:
      "Các đoạn hội thoại kiểm thử độc lập. Chỉ áp dụng quan hệ cho đúng nhân vật. Đoạn nhà hàng bàn về ngày nghỉ mỗi tháng và nghỉ cuối tuần.",
    terms: [
      { source: "沈总", target: "Tổng giám đốc Thẩm", strict: true },
      {
        source: "白月光",
        target: "mối tình lý tưởng",
        notes: "Ẩn dụ về người yêu lý tưởng trong lòng, không dịch mặt trăng.",
        strict: true,
      },
      { source: "服务员", target: "nhân viên phục vụ", strict: true },
      { source: "双休", target: "nghỉ hai ngày cuối tuần", strict: true },
    ],
    characters: [
      { id: "em", vi: "em gái" },
      { id: "chi", vi: "chị gái" },
      { id: "employee", vi: "nhân viên" },
      { id: "boss", zh: "沈总", vi: "Tổng giám đốc Thẩm" },
      { id: "worker", vi: "nhân viên nhà hàng" },
      { id: "peer", vi: "đồng nghiệp" },
    ],
    relations: [
      { from: "em", to: "chi", self: "em", address: "chị" },
      { from: "chi", to: "em", self: "chị", address: "em" },
      { from: "employee", to: "boss", self: "tôi", address: "ông" },
      { from: "worker", to: "peer", self: "tôi", address: "cậu" },
    ],
    notes: [],
  },
  0,
);
const e = store.addEpisode(series.id, { cues: input }),
  signal = new AbortController().signal;
const result = {
  model: config.ollamaModel,
  hardware: "CPU laptop; RX 5600 XT not tested",
  input,
  started: new Date().toISOString(),
};
try {
  let start = Date.now();
  console.log("OPUS baseline");
  result.opus = await translateOpus(input, config, {
    root,
    dir: store.episodeDir(e.id),
    signal,
    store,
    id: e.id,
  });
  result.opusMs = Date.now() - start;
  store.patch(e.id, { cues: input });
  start = Date.now();
  console.log("Qwen contextual translation");
  result.qwen = await translateContext(
    store,
    input,
    series.options,
    config,
    signal,
    (n, total) => console.log(`Translated ${n}/${total}`),
    e.id,
  );
  result.qwenMs = Date.now() - start;
  await fs.writeFile(
    path.join(folder, "latest.json"),
    JSON.stringify(result, null, 2),
  );
  const bad = structuredClone(result.qwen);
  bad[0].vi = "Anh không cố ý đâu, em gái.";
  bad[3].vi = "Anh ấy là ánh trăng trắng trong tim cô ấy.";
  bad[7].vi = "Tôi đã nói cô ấy ăn cắp tiền.";
  store.patch(e.id, { cues: bad });
  start = Date.now();
  console.log("AI review with 3 seeded meaning/pronoun errors");
  result.review = await reviewTranslation(
    store,
    e.id,
    config,
    signal,
    (n, total) => console.log(`Reviewed ${n}/${total}`),
  );
  result.reviewMs = Date.now() - start;
  result.seededErrors = ["1", "4", "8"];
  result.timestampUnchanged =
    JSON.stringify(input.map((c) => [c.start, c.end])) ===
    JSON.stringify(result.qwen.map((c) => [c.start, c.end]));
  await fs.writeFile(
    path.join(folder, "latest.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      qwenMs: result.qwenMs,
      reviewMs: result.reviewMs,
      reviewStatus: result.review.status,
      timestampUnchanged: result.timestampUnchanged,
      result: path.join(folder, "latest.json"),
    }),
  );
} catch (error) {
  result.error = error.message;
  await fs.writeFile(
    path.join(folder, "latest.json"),
    JSON.stringify(result, null, 2),
  );
  throw error;
} finally {
  store.close();
}

import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { hash, validateCues } from "./core.mjs";
import { runOpus } from "./opus-runtime.mjs";
export async function translateOpus(cues, c, { root, dir, signal, store, id }) {
  if (!c.opusModel || !existsSync(path.join(c.opusModel, "pytorch_model.bin")))
    throw Error("Chưa cài mô hình OPUS CPU. Chạy scripts/install-opus.py.");
  const result = cues.map((q) => ({ ...q })),
    missing = [];
  for (const q of result) {
    if (q.vi) continue;
    const cached = store.cached(
      hash({ provider: "opus-zh-vi", model: c.opusModel, text: q.text }),
    );
    if (cached) q.vi = cached;
    else missing.push(q);
  }
  if (missing.length) {
    store.log(
      id,
      "OPUS CPU: dịch từng câu. Chế độ này không áp dụng ngữ cảnh và bảng thuật ngữ LLM; cần duyệt bản dịch.",
    );
    await fs.writeFile(
      path.join(dir, "opus-input.json"),
      JSON.stringify(missing),
    );
    const output = path.join(dir, "opus-output.json");
    await fs.rm(output, { force: true });
    const checkpoint = () => {
      if (!existsSync(output)) return;
      const rows = JSON.parse(readFileSync(output, "utf8"));
      for (const q of missing) {
        const row = rows.find((r) => r.id === q.id);
        if (row && typeof row.vi === "string" && row.vi.trim()) {
          q.vi = row.vi;
          store.cached(
            hash({ provider: "opus-zh-vi", model: c.opusModel, text: q.text }),
            q.vi,
          );
        }
      }
      store.patch(id, {
        cues: validateCues(result),
        revision: store.episode(id).revision + 1,
        translationCheckpoint: {
          done: result.filter((q) => q.vi).length,
          total: result.length,
          provider: "opus",
        },
      });
    };
    try {
      await runOpus(
        c, root, dir,
        {
          cwd: dir,
          signal,
          timeout: 12 * 3600000,
          onLine: (line) => {
            const m = line.match(/Translated (\d+)\/(\d+)/);
            if (m) checkpoint();
            if (m)
              store.patch(id, {
                progress: 40 + Math.round((25 * Number(m[1])) / Number(m[2])),
                stage: `OPUS: ${m[1]}/${m[2]} câu`,
              });
          },
        },
      );
    } finally {
      checkpoint();
    }
    const translated = JSON.parse(
      await fs.readFile(path.join(dir, "opus-output.json"), "utf8"),
    );
    for (const q of missing) {
      const row = translated.find((t) => t.id === q.id);
      if (!row || typeof row.vi !== "string" || !row.vi.trim())
        throw Error("OPUS trả thiếu câu");
      q.vi = row.vi;
      store.cached(
        hash({ provider: "opus-zh-vi", model: c.opusModel, text: q.text }),
        q.vi,
      );
    }
  }
  return validateCues(result);
}

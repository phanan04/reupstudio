import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { hash, validateCues } from "./core.mjs";
import { mergeTranslations } from "./cue-merge.mjs";
import { runOpus } from "./opus-runtime.mjs";
import { recordStage } from "./streaming.mjs";
export async function translateOpus(cues, c, { root, dir, signal, store, id }) {
  const retry = store.episode(id).translationRetry?.nonce;
  const cacheKey = text => hash({ provider: "opus-zh-vi", model: c.opusModel, text, ...(retry ? { retry } : {}) });
  if (!c.opusModel || !existsSync(path.join(c.opusModel, "pytorch_model.bin")))
    throw Error("Chưa cài mô hình OPUS CPU. Chạy scripts/install-opus.py.");
  const result = cues.map((q) => ({ ...q })),
    missing = [];
  for (const q of result) {
    if (q.vi) continue;
    const cached = store.cached(
      cacheKey(q.text),
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
    let tick = performance.now();
    const checkpoint = () => {
      if (!existsSync(output)) return;
      const rows = JSON.parse(readFileSync(output, "utf8"));
      if (!Array.isArray(rows) || new Set(rows.map(q => q.id)).size !== rows.length || rows.some(q => !missing.some(cue => cue.id === q.id)))
        throw Error("OPUS trả ID không hợp lệ hoặc trùng ID");
      for (const q of missing) {
        const row = rows.find((r) => r.id === q.id);
        if (row && typeof row.vi === "string" && row.vi.trim()) {
          q.vi = row.vi;
          store.cached(
            cacheKey(q.text),
            q.vi,
          );
        }
      }
      mergeTranslations(store, id, cues, result, { provider: "opus" });
      const e = store.episode(id), done = e.cues.filter(q => q.vi?.trim()).length;
      const total = e.asrManifest && !e.asrManifest.complete ? null : e.cues.length;
      const now = performance.now();
      recordStage(store, id, "translation", done, total, now - tick, total !== null && done === total);
      tick = now;
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
        cacheKey(q.text),
        q.vi,
      );
    }
  }
  return mergeTranslations(store, id, cues, result, { provider: "opus" });
}

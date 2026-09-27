import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Store, optionDefaults } from "../server/store.mjs";
import { validateCues, ass, options, hash } from "../server/core.mjs";
import { translateOpus } from "../server/opus.mjs";
import { mergeTranslations, editCuePatch } from "../server/cue-merge.mjs";
import { boundedPipeline, chooseBoundary, alignChunk, resourcePlan, recognizeChunks, recordStage } from "../server/streaming.mjs";
import { Pipeline } from "../server/pipeline.mjs";

const fixture = async fn => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vietstudio-stream-")), store = new Store(dir);
  try { await fn(store, dir, store.addEpisode(store.listSeries()[0].id, {})); }
  finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
};
const cue = (id, start = 0) => ({ id, start, end: start + 2, text: "你好", vi: "", voice: "" });

test("Stable cue IDs survive removal and appending; duplicate IDs are rejected", () => {
  assert.deepEqual(validateCues([cue("10"), cue("20", 4)]).map(c => c.id), ["10", "20"]);
  assert.throws(() => validateCues([cue("10"), cue("10", 4)]), /ID/);
  assert.equal(validateCues([cue("2"), { start: 4, end: 6 }])[1].id, "1");
});
test("Streaming translation merge retains appended cues and concurrent source/user edits", () => fixture(async (s, _, e) => {
  const before = [cue("a"), cue("b", 3), cue("c", 6)];
  s.patch(e.id, { cues: [before[0], { ...before[1], vi: "Bản sửa tay" }, { ...before[2], text: "Nguồn đã sửa" }, cue("new", 9)] });
  const merged = mergeTranslations(s, e.id, before, before.map(c => ({ ...c, vi: "AI" })));
  assert.equal(merged.length, 4);
  assert.deepEqual(merged.map(c => c.vi), ["AI", "Bản sửa tay", "", ""]);
  assert.equal(merged[2].text, "Nguồn đã sửa");
}));
test("Per-cue edits accept unrelated appended cues but reject stale same-cue writes", () => {
  const a = cue("a"), b = cue("b", 3);
  assert.equal(editCuePatch([a, b], [{ id: "a", base: a, value: { ...a, vi: "Edited" } }])[1].id, "b");
  assert.throws(() => editCuePatch([{ ...a, vi: "New" }], [{ id: "a", base: a, value: a }]), e => e.status === 409);
});
test("Bounded pipeline overlaps only one ASR with ordered translation and joins failed prefetch", async () => {
  let asr = 0, translation = 0, max = 0, translated = [], stopped = false;
  async function* producer(signal) {
    try { for (let i = 0; i < 4; i++) { asr++; max = Math.max(max, asr + translation); await delay(8, null, { signal }); asr--; yield i; } }
    finally { stopped = true; }
  }
  await boundedPipeline(producer, async i => { translation++; max = Math.max(max, asr + translation); await delay(12); translated.push(i); translation--; });
  assert.deepEqual(translated, [0, 1, 2, 3]); assert.equal(max, 2); assert.ok(stopped);
  stopped = false;
  await assert.rejects(boundedPipeline(producer, async () => { throw Error("translation failed"); }), /translation failed/);
  assert.ok(stopped);
});
test("Low-memory resource policy serializes work and segmentation preserves global timing", () => {
  assert.equal(resourcePlan({ threads: 4 }, { cores: 8, free: 1024 ** 3, load: 0 }).slots, 1);
  assert.equal(resourcePlan({ threads: 4 }, { cores: 8, free: 8 * 1024 ** 3, load: 0 }).slots, 2);
  assert.equal(chooseBoundary("silence_start: 39\nsilence_end: 41", 0, 45, 0, 90), 40);
  const aligned = alignChunk([cue("1", .123)], { index: 2, offset: 44, start: 45, end: 90 }, 100);
  assert.equal(aligned[0].start, 44.123); assert.equal(aligned[0].end, 46.123);
});
test("Chunk checkpoint resumes after failure without redoing committed ASR or overwriting edits", () => fixture(async (store, dir, e) => {
  const source = path.join(dir, "source.mp4"), model = path.join(dir, "model.bin");
  await fs.writeFile(source, "fixture"); await fs.writeFile(model, "fixture");
  let calls = [], fail = true;
  const exec = async (bin, args, opts) => {
    if (bin === "ffmpeg") { await fs.writeFile(args.at(-1), "wave"); opts.onLine?.("silence_start: 39\nsilence_end: 41"); return ""; }
    const output = args[args.indexOf("-of") + 1]; calls.push(path.basename(output));
    if (output.endsWith("asr-1") && fail) throw Error("injected ASR failure");
    await fs.writeFile(output + ".srt", "1\n00:00:01,123 --> 00:00:03,456\n你好\n"); return "";
  };
  const params = { store, id: e.id, source, duration: 80, c: { ffmpeg: "ffmpeg", whisper: "whisper", whisperModel: model, threads: 2 }, dir, signal: new AbortController().signal, exec };
  await assert.rejects(async () => { for await (const _ of recognizeChunks(params)) {} }, /injected/);
  assert.deepEqual(calls, ["asr-0", "asr-1", "asr-1"]);
  const original = store.episode(e.id).cues[0];
  store.patch(e.id, { cues: [{ ...original, vi: "Bản duyệt" }] });
  fail = false; calls = [];
  for await (const _ of recognizeChunks(params)) {}
  assert.deepEqual(calls, ["asr-1"]);
  assert.equal(store.episode(e.id).cues[0].vi, "Bản duyệt");
  assert.equal(store.episode(e.id).cues[0].start, 1.123);
  assert.ok(store.episode(e.id).asrManifest.complete);
}));
test("Progress ETA stays unknown until measured and pause/resume retains job mode", () => fixture(async (s, dir, e) => {
  recordStage(s, e.id, "asr", 10, 100, 2000);
  assert.equal(s.episode(e.id).pipelineMetrics.asr.etaSeconds, null);
  recordStage(s, e.id, "asr", 20, 100, 2000);
  assert.equal(s.episode(e.id).pipelineMetrics.asr.etaSeconds, 16);
  const p = new Pipeline(s, dir); p.pump = () => {};
  p.enqueue(e.id, "quality"); p.pause(e.id);
  assert.equal(s.episode(e.id).status, "paused"); p.resume(e.id);
  assert.equal(p.pending[0].mode, "quality");
}));
test("Subtitle styling is validated and rendered into ASS without modifying cues", () => {
  const c = [cue("stable")], copy = structuredClone(c);
  const style = options({ subtitleFont: "Verdana", subtitleSize: 60, subtitleColor: "#FF3300" }, optionDefaults);
  assert.match(ass(c, style), /Default,Verdana,60,&H000033FF/);
  assert.deepEqual(c, copy);
  assert.throws(() => options({ subtitleFont: "Arial,Injected" }, optionDefaults));
});

test("Legacy project options inherit new defaults and incomplete ASR cannot render", () => fixture(async (s, dir, e) => {
  s.db.prepare('UPDATE series SET options=? WHERE id=?').run(JSON.stringify({ subtitleMode: 'auto' }), e.seriesId);
  assert.equal(s.series(e.seriesId).options.subtitleFont, 'Arial');
  s.patch(e.id, { asrManifest: { complete: false } });
  const p = new Pipeline(s, dir);
  assert.throws(() => p.enqueue(e.id, 'render'), /nhận diện hết/);
  assert.equal(p.pending.length, 0);
}));

test("OPUS cache-only translation is committed without launching a worker", () => fixture(async (s, dir, e) => {
  await fs.writeFile(path.join(dir, "pytorch_model.bin"), "fixture marker, never loaded");
  const cues = [cue("stable")];
  s.patch(e.id, { cues });
  s.cached(hash({ provider: "opus-zh-vi", model: dir, text: cues[0].text }), "Xin chào");
  const result = await translateOpus(cues, { opusModel: dir }, { root: dir, dir, store: s, id: e.id, signal: new AbortController().signal });
  assert.equal(result[0].vi, "Xin chào");
  assert.equal(s.episode(e.id).cues[0].vi, "Xin chào");
}));

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { run, hash, parseSubtitles, validateCues } from "./core.mjs";

export function resourcePlan(c, sample = { cores: os.availableParallelism(), free: os.freemem(), load: os.loadavg()[0] }) {
  const cpuTranslation = c.forceCpu || c.translationEngine === "opus";
  const parallel = sample.cores >= (cpuTranslation ? 6 : 4) && sample.free >= 4 * 1024 ** 3 && sample.load < sample.cores * .9;
  return { parallel, slots: parallel ? 2 : 1, asrBackend: "CPU", gpuBackend: "Chưa xác minh",
    asrThreads: Math.max(1, Math.min(c.threads || 4, Math.floor(sample.cores / (parallel ? 2 : 1)))),
    freeGiB: Math.round(sample.free / 1024 ** 3 * 10) / 10,
    reason: parallel ? "ASR CPU + dịch; tối đa một đoạn chờ" : "Tuần tự để giữ RAM/CPU cho mô hình" };
}

// One ASR producer, one ordered translator, at most one prefetched segment.
// Observe prefetch rejection immediately; abort/join it if translation fails.
export async function boundedPipeline(produce, consume, { signal, parallel = () => true } = {}) {
  const controller = new AbortController(), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const iterator = produce(combined)[Symbol.asyncIterator]();
  let pending;
  const next = () => iterator.next().then(value => ({ value }), error => ({ error }));
  try {
    pending = next();
    while (true) {
      const item = await pending;
      if (item.error) throw item.error;
      if (item.value.done) break;
      if (combined.aborted) throw Error("Đã tạm dừng");
      const overlap = parallel();
      pending = overlap ? next() : null;
      await consume(item.value.value, combined);
      if (!overlap) pending = next();
    }
  } finally {
    controller.abort();
    if (pending) await pending;
    await iterator.return?.();
  }
}

export function chooseBoundary(log, start, target, offset, duration) {
  if (target >= duration) return duration;
  // Prefer the middle of a pause; silence detection is segmentation, not proof of speech.
  const ranges = [...log.matchAll(/silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g)];
  const candidates = ranges.map(m => offset + (Number(m[1]) + Number(m[2])) / 2)
    .filter(t => t >= start + 25 && t <= target);
  return Math.round((candidates.at(-1) ?? target) * 1000) / 1000;
}

export function alignChunk(cues, chunk, duration) {
  return validateCues(cues.map((cue, index) => ({ ...cue, id: `asr-${chunk.index}-${index + 1}`,
    start: Math.round((cue.start + chunk.offset) * 1000) / 1000,
    end: Math.min(duration, Math.round((cue.end + chunk.offset) * 1000) / 1000) }))
    .filter(cue => (cue.start + cue.end) / 2 >= chunk.start && (cue.start + cue.end) / 2 < chunk.end && cue.end > cue.start));
}

export function recordStage(store, id, name, done, total, ms, complete = false) {
  const e = store.episode(id), metrics = { ...e.pipelineMetrics }, prev = metrics[name] || {};
  const delta = Math.max(0, done - (prev.done || 0));
  const rate = delta > 0 && ms > 0 ? ms / delta : prev.msPerUnit;
  const samples = (prev.samples || 0) + Number(delta > 0 && ms > 0);
  const msPerUnit = rate ? (prev.msPerUnit ? .65 * prev.msPerUnit + .35 * rate : rate) : null;
  metrics[name] = { done, total, elapsedMs: (prev.elapsedMs || 0) + ms, samples, msPerUnit,
    etaSeconds: complete ? 0 : samples >= 2 && total != null && msPerUnit ? Math.ceil((total - done) * msPerUnit / 1000) : null,
    status: complete ? "complete" : "running", updated: Date.now() };
  store.patch(id, { pipelineMetrics: metrics });
}

export async function* recognizeChunks({ store, id, source, duration, c, dir, signal, exec = run }) {
  const stat = await fs.stat(source), modelStat = await fs.stat(c.whisperModel);
  let vad = false;
  if (c.whisperVadModel && existsSync(c.whisperVadModel)) {
    let help = "";
    await exec(c.whisper, ["--help"], { signal, timeout: 15000, onLine: text => { help += text; } });
    vad = help.includes("--vad-model");
  }
  store.patch(id, { speechDetection: vad ? "Silero VAD + chia đoạn theo khoảng lặng" : "Chia đoạn theo khoảng lặng; chưa có Silero VAD khả dụng" });
  const key = hash({ version: 1, vad, size: stat.size, mtime: stat.mtimeMs, model: c.whisperModel, modelSize: modelStat.size, modelMtime: modelStat.mtimeMs });
  let manifest = store.episode(id).asrManifest;
  if (manifest && manifest.key !== key && store.episode(id).cues.length)
    throw Error("Nguồn hoặc mô hình ASR đã thay đổi. Giữ bản sửa hiện tại; tạo tập mới để nhận diện lại.");
  manifest = manifest?.key === key ? manifest : { key, chunks: [], complete: false };
  const save = () => store.patch(id, { asrManifest: manifest });
  let index = 0, cursor = 0;
  while (cursor < duration - .01) {
    if (signal.aborted) throw Error("Đã tạm dừng");
    let chunk = manifest.chunks[index];
    if (chunk?.done) { cursor = chunk.end; index++; yield chunk; continue; }
    const plan = resourcePlan(c), preparedAt = performance.now();
    store.patch(id, { resourcePlan: plan, stage: `Nhận diện đoạn ${index + 1}`, status: "running" });
    const offset = chunk?.offset ?? Math.max(0, cursor - 1), target = Math.min(duration, cursor + 45);
    const length = Math.min(duration, target + 5) - offset;
    const wav = path.join(dir, `asr-${index}.wav`), output = path.join(dir, `asr-${index}`);
    if (!chunk?.audioReady || !existsSync(wav)) {
      let log = "";
      await exec(c.ffmpeg, ["-y", "-ss", String(offset), "-i", source, "-t", String(length), "-vn", "-ar", "16000", "-ac", "1",
        "-af", "silencedetect=noise=-45dB:d=0.35", "-c:a", "pcm_s16le", wav],
      { signal, cwd: dir, onLine: line => { log = (log + line).slice(-200000); } });
      chunk = { index, start: cursor, end: chooseBoundary(log, cursor, target, offset, duration), offset, length, audioReady: true, attempts: 0 };
      manifest.chunks[index] = chunk; save();
    }
    recordStage(store, id, "audio", chunk.end, duration, performance.now() - preparedAt, chunk.end >= duration - .01);
    const started = performance.now();
    let recognized;
    for (let attempt = 0; attempt < 2; attempt++) {
      chunk.attempts++; save();
      try {
        // CPU ASR prevents unverified GPU memory overlap with the translation model.
        await fs.rm(output + ".srt", { force: true });
        await exec(c.whisper, ["-m", c.whisperModel, "-f", wav, "-l", "zh", "-ng", "-osrt", "-of", output,
          "-t", String(plan.asrThreads), ...(vad ? ["--vad", "--vad-model", c.whisperVadModel] : []), "--prompt", store.episode(id).cues.slice(-4).map(q => q.text).join(" ").slice(-600)],
        { signal, cwd: dir, timeout: 12 * 3600000 });
        const raw = await fs.readFile(output + ".srt", "utf8");
        const local = raw.trim() ? parseSubtitles(raw) : [];
        if (local.some(q => q.end > chunk.length + .25)) throw Error("ASR trả thời gian ngoài đoạn âm thanh");
        if (!local.length && attempt === 0) throw Error("ASR chưa trả câu; thử kiểm tra lại riêng đoạn này");
        recognized = alignChunk(local, chunk, duration);
        if (recognized.some(q => q.end > chunk.offset + chunk.length + .25)) throw Error("ASR trả thời gian ngoài đoạn âm thanh");
        break;
      } catch (error) {
        chunk.error = error.message; save();
        if (signal.aborted || attempt === 1) throw error;
        store.log(id, `Thử lại riêng đoạn ASR ${index + 1}: ${error.message}`);
      }
    }
    const current = store.episode(id);
    // Add new IDs only. Never overwrite a cue edited while the next chunk was running.
    const additions = recognized.filter(q => !current.cues.some(old => old.id === q.id));
    const cues = validateCues([...current.cues, ...additions].sort((a, b) => a.start - b.start));
    chunk.done = true; chunk.error = null; chunk.cueIds = recognized.map(q => q.id);
    chunk.warning = !recognized.length ? "Không nhận được câu trong đoạn; cần kiểm tra âm thanh" : null;
    manifest.complete = chunk.end >= duration - .01;
    store.patch(id, { cues, revision: current.revision + Number(additions.length > 0), asrManifest: manifest,
      progress: Math.round(55 * chunk.end / duration) });
    recordStage(store, id, "asr", chunk.end, duration, performance.now() - started, manifest.complete);
    cursor = chunk.end; index++;
    yield chunk;
  }
}

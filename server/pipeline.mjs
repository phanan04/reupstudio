import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  run,
  hash,
  parseSubtitles,
  validateCues,
  ass,
  srt,
  localEndpoint,
  validateUrl,
} from "./core.mjs";
import { withProvider, providerIdentity } from "./ai-provider.mjs";
import {
  translateContext,
  reviewTranslation,
  qualityFingerprint,
} from "./translation.mjs";
import { reuseMemory } from "./knowledge.mjs";
import { translateOpus } from "./opus.mjs";
import { runtimeSettings } from "./runtime.mjs";
import { mergeTranslations } from "./cue-merge.mjs";
import { boundedPipeline, recognizeChunks, resourcePlan, recordStage } from "./streaming.mjs";
export class Pipeline {
  constructor(store, root) {
    this.store = store;
    this.root = root;
    this.pending = [];
    this.active = null;
    this.prepareTail = Promise.resolve();
    this.preparing = new Map();
    this.prepareController = new AbortController();
  }
  enqueue(id, mode = "all") {
    const e = this.store.episode(id);
    if (!e) throw Error("Không tìm thấy tập");
    if (mode === "all" && e.subtitleOnly) mode = "translate";
    if (["running", "queued"].includes(e.status))
      throw Error("Tập đã nằm trong hàng đợi");
    if (!["all", "render", "translate", "quality", "prepare"].includes(mode))
      throw Error("Chế độ không hợp lệ");
    if (mode === "render" && e.asrManifest && !e.asrManifest.complete)
      throw Error("Hãy tiếp tục nhận diện hết video trước khi xuất");
    this.store.patch(id, {
      status: "queued",
      progress: 0,
      stage: "Đang chờ",
      jobMode: mode,
      error: null,
    });
    this.pending.push({ id, mode });
    queueMicrotask(() => this.pump());
  }
  pause(id) {
    const e = this.store.episode(id);
    if (!["running", "queued"].includes(e.status)) throw Error("Không có tác vụ đang chạy để tạm dừng");
    if (this.active?.id === id) { this.active.paused = true; this.active.controller.abort(); }
    else { this.pending = this.pending.filter(j => j.id !== id); this.store.patch(id, { status: "paused", stage: "Đã tạm dừng", jobMode: e.jobMode || "all" }); }
  }
  resume(id) {
    const e = this.store.episode(id);
    if (!["paused", "interrupted", "failed", "cancelled"].includes(e.status)) throw Error("Tập không ở trạng thái có thể tiếp tục");
    this.enqueue(id, e.jobMode || (e.subtitleOnly ? "translate" : "all"));
  }
  cancel(id) {
    this.pending = this.pending.filter((j) => j.id !== id);
    if (this.active?.id === id) this.active.controller.abort();
    else this.store.patch(id, { status: "cancelled", stage: "Đã dừng" });
  }
  async pump() {
    if (this.active || !this.pending.length) return;
    const job = this.pending.shift(),
      controller = new AbortController();
    this.active = { ...job, controller };
    try {
      await this.process(job, controller.signal);
    } catch (e) {
      this.store.patch(job.id, {
        status: this.active?.paused ? "paused" : controller.signal.aborted ? "cancelled" : "failed",
        error: controller.signal.aborted ? null : e.message,
        stage: this.active?.paused ? "Đã tạm dừng — có thể tiếp tục" : controller.signal.aborted ? "Đã dừng" : "Xử lý thất bại",
      });
      this.store.log(job.id, e.message);
    } finally {
      this.active = null;
      queueMicrotask(() => this.pump());
    }
  }
  async inspect(url, signal) {
    const c = runtimeSettings(this.store.settings(), this.root);
    return JSON.parse(
      await run(
        c.ytdlp,
        [
          "--ignore-config",
          "--flat-playlist",
          "--dump-single-json",
          "--no-warnings",
          "--playlist-end",
          "500",
          ...this.cookies(c),
          "--",
          validateUrl(url),
        ],
        { signal, timeout: 180000, maxOutput: 16 * 1024 * 1024 },
      ),
    );
  }
  cookies(c) {
    return c.cookies ? ["--cookies", c.cookies] : [];
  }
  async probe(file, c, signal) {
    return JSON.parse(
      await run(
        c.ffprobe,
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
        { signal, timeout: 60000 },
      ),
    );
  }
  prepareUpload(id) {
    if (this.preparing.has(id)) return this.preparing.get(id);
    const task = this.prepareTail.then(async () => {
      if (this.prepareController.signal.aborted) return;
      const e = this.store.episode(id);
      if (!e?.source) return;
      try { await this.probeEpisode(id, path.join(this.store.episodeDir(id), e.source), runtimeSettings(this.store.settings(), this.root), this.prepareController.signal); }
      catch (error) { if (this.store.episode(id)) this.store.patch(id, { prepareError: error.message }); }
    });
    this.prepareTail = task.catch(() => {});
    this.preparing.set(id, task);
    task.then(() => this.preparing.delete(id), () => this.preparing.delete(id));
    return task;
  }
  async probeEpisode(id, file, c, signal) {
    const stat = await fs.stat(file), key = hash([stat.size, stat.mtimeMs]);
    const e = this.store.episode(id);
    if (e.probeKey === key && e.probeInfo) return e.probeInfo;
    const info = await this.probe(file, c, signal), video = info.streams.find(s => s.codec_type === "video");
    if (!video) throw Error("Tệp không có luồng video");
    const duration = Number(info.format.duration || video.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw Error("Thời lượng video không hợp lệ");
    if (this.store.episode(id)) this.store.patch(id, { probeKey: key, probeInfo: info, prepareError: null,
      media: { width: video.width, height: video.height, duration, hasAudio: info.streams.some(s => s.codec_type === "audio") } });
    return info;
  }
  async process({ id, mode }, signal) {
    const store = this.store,
      c = runtimeSettings(store.settings(), this.root),
      e = store.episode(id),
      o = { ...store.series(e.seriesId).options },
      dir = store.episodeDir(id);
    const cmd = (bin, args, extra = {}) =>
      run(bin, args, { cwd: dir, signal, ...extra });
    const stage = (name, progress) => {
      if (signal.aborted) throw Error("Đã hủy");
      store.patch(id, { status: "running", stage: name, progress });
      store.log(id, name);
    };
    if (mode === "translate" || mode === "quality") {
      if (!e.cues.length) throw Error("Chưa có phụ đề để xử lý");
      stage(
        mode === "quality" ? "Kiểm tra bản dịch" : "Dịch phụ đề còn thiếu",
        5,
      );
      if (mode === "translate")
        await this.translateEpisode(e.cues, o, c, signal, id);
      else
        await withProvider(
          c,
          signal,
          () =>
            reviewTranslation(store, id, c, signal, (done, total) =>
              stage(
                `Kiểm tra ${done}/${total} câu`,
                Math.round((done / total) * 95),
              ),
            ),
          (m) => store.log(id, m),
        );
      store.patch(id, {
        status: "review",
        stage: "Sẵn sàng duyệt bản dịch",
        progress: 100,
      });
      return;
    }
    stage("Chuẩn bị video", 2);
    let source = e.source;
    if (!source || !existsSync(path.join(dir, source))) {
      if (!e.url) throw Error("Chưa có video nguồn");
      stage("Đang tải video và phụ đề", 5);
      await cmd(
        c.ytdlp,
        [
          "--ignore-config",
          "--no-playlist",
          "--no-warnings",
          "--newline",
          "--ffmpeg-location",
          path.dirname(c.ffmpeg) === "." ? c.ffmpeg : path.dirname(c.ffmpeg),
          "-f",
          `bv*[height<=${o.downloadHeight}]+ba/b[height<=${o.downloadHeight}]`,
          "--merge-output-format",
          "mp4",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs",
          "zh.*,ai-zh.*",
          "--sub-format",
          "srt/best",
          "-o",
          "source.%(ext)s",
          ...this.cookies(c),
          "--",
          validateUrl(e.url),
        ],
        { timeout: 6 * 3600000 },
      );
      const files = await fs.readdir(dir);
      source = files.find((f) => /^source\.(mp4|mkv|webm|mov|flv)$/.test(f));
      if (!source) throw Error("Không tìm thấy video sau khi tải");
      store.patch(id, { source });
    }
    if (this.preparing.has(id)) await this.preparing.get(id);
    const info = await this.probeEpisode(id, path.join(dir, source), c, signal),
      video = info.streams.find((s) => s.codec_type === "video");
    if (!video) throw Error("Tệp không có luồng video");
    const duration = Number(info.format.duration || video.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
      throw Error("Thời lượng video không hợp lệ (tối đa 24 giờ)");
    const media = {
      width: video.width,
      height: video.height,
      duration,
      hasAudio: info.streams.some((s) => s.codec_type === "audio"),
    };
    store.patch(id, { media });
    if (mode === "prepare") { store.patch(id, { status: "idle", stage: "Video sẵn sàng", progress: 100 }); return; }
    let cues = store.episode(id).cues, streamed = false;
    if (mode === "all") {
      const extractionKey = hash({
        source,
        o: o.subtitleMode,
        roi: [o.roiX, o.roiY, o.roiW, o.roiH],
        model: c.whisperModel,
      });
      if (o.subtitleMode === "manual") {
        if (!cues.length) throw Error("Hãy nhập phụ đề hoặc chọn Whisper/OCR");
      } else if (
        !cues.length ||
        (!e.manualCues && e.extractionKey !== extractionKey) ||
        (e.asrManifest && !e.asrManifest.complete)
      ) {
        stage("Trích xuất phụ đề tiếng Trung", 20);
        cues = [];
        if (o.subtitleMode === "auto") {
          const files = await fs.readdir(dir);
          for (const file of files.filter((f) =>
            /^source\..*\.(srt|vtt|json)$/.test(f),
          )) {
            try {
              cues = parseSubtitles(
                await fs.readFile(path.join(dir, file), "utf8"),
              );
              break;
            } catch {}
          }
          if (!cues.length) {
            const sub = info.streams.find(
              (s) =>
                s.codec_type === "subtitle" &&
                ["chi", "zho", "zh", "zh-CN"].includes(s.tags?.language),
            );
            if (sub) {
              try {
                await cmd(c.ffmpeg, [
                  "-y",
                  "-i",
                  source,
                  "-map",
                  `0:${sub.index}`,
                  "embedded.srt",
                ]);
                cues = parseSubtitles(
                  await fs.readFile(path.join(dir, "embedded.srt"), "utf8"),
                );
              } catch (err) {
                store.log(id, "Phụ đề nhúng không đọc được: " + err.message);
              }
            }
          }
        }
        if (!cues.length && o.subtitleMode === "ocr") {
          stage("OCR vùng phụ đề trên hình", 25);
          await cmd(
            c.python,
            [
              path.join(this.root, "workers", "ocr.py"),
              "--input",
              path.join(dir, source),
              "--output",
              path.join(dir, "ocr.json"),
              "--roi",
              [o.roiX, o.roiY, o.roiW, o.roiH].join(","),
              ...(c.ocrDirectML ? ["--directml"] : []),
            ],
            { timeout: 12 * 3600000 },
          );
          cues = parseSubtitles(
            await fs.readFile(path.join(dir, "ocr.json"), "utf8"),
          );
        }
        if (!cues.length) {
          if (!media.hasAudio)
            throw Error("Video không có âm thanh; chọn OCR hoặc nhập SRT");
          if (!c.whisperModel || !existsSync(c.whisperModel))
            throw Error("Chưa cài mô hình Whisper. Mở Cấu hình máy.");
          await this.streamAsr({ id, source: path.join(dir, source), duration, c, o, dir, signal });
          cues = store.episode(id).cues;
          streamed = true;
        }
        store.patch(id, {
          cues,
          extractionKey,
          manualCues: Boolean(store.episode(id).manualCues),
          revision: store.episode(id).revision + 1,
        });
      }
      if (!cues.length) throw Error("Không tìm thấy lời thoại/phụ đề");
      stage("Dịch tiếng Việt theo ngữ cảnh", 40);
      if (!streamed) cues = await this.translateEpisode(cues, o, c, signal, id);
      store.patch(id, { cues });
      await fs.writeFile(path.join(dir, "vietnamese.srt"), srt(cues));
      { // Rendering is an explicit user action; processing stops at review.
        store.patch(id, {
          status: "review",
          stage: "Bản dịch sẵn sàng để duyệt",
          progress: 100,
        });
        store.log(id, "Duyệt phụ đề rồi chọn “Xuất từ bản dịch đã sửa”.");
        return;
      }
    }
    if (!cues.length || cues.some((q) => !q.vi?.trim()))
      throw Error("Cần bản dịch tiếng Việt đầy đủ trước khi xuất");
    if (cues.some((q) => q.end > duration + 0.25))
      throw Error("Có câu phụ đề vượt thời lượng video");
    await fs.writeFile(path.join(dir, "vietnamese.srt"), srt(cues));
    await fs.writeFile(path.join(dir, "vietnamese.ass"), ass(cues, o));
    let dubFile = null;
    if (o.dub) {
      stage("Tạo giọng đọc tiếng Việt", 68);
      const segments = cues.map((q, i) => ({
        id: i,
        start: q.start,
        end: q.end,
        text: q.vi,
        voice: q.voice || o.voice,
      }));
      for (const q of segments) {
        if (!existsSync(path.join(c.voicesDir, q.voice + ".onnx")))
          throw Error(
            `Thiếu giọng ${q.voice}. Cài mô hình Piper trong Cấu hình máy.`,
          );
      }
      await fs.writeFile(
        path.join(dir, "tts-input.json"),
        JSON.stringify(segments),
      );
      await cmd(
        c.python,
        [
          path.join(this.root, "workers", "tts.py"),
          "--input",
          path.join(dir, "tts-input.json"),
          "--voices",
          c.voicesDir,
          "--output",
          path.join(dir, "tts"),
        ],
        { timeout: 12 * 3600000 },
      );
      stage("Căn giọng đọc vào từng câu", 78);
      const parts = [];
      let cursor = 0;
      let serial = 0;
      for (let i = 0; i < segments.length; i++) {
        const q = segments[i];
        if (q.start < cursor - 0.025)
          throw Error(
            `Câu ${i + 1} chồng thời gian. Hãy chỉnh phụ đề trước khi lồng tiếng.`,
          );
        if (q.start > cursor + 0.005) {
          const name = `silence-${serial++}.wav`;
          await cmd(c.ffmpeg, [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=24000:cl=mono",
            "-t",
            (q.start - cursor).toFixed(3),
            "-c:a",
            "pcm_s16le",
            path.join("tts", name),
          ]);
          parts.push(name);
        }
        const raw = path.join("tts", `${i}.wav`),
          probe = await this.probe(path.join(dir, raw), c, signal),
          length = Number(probe.format.duration),
          available = q.end - q.start;
        const speed = Math.max(1, length / available);
        if (speed > c.maxSpeed)
          throw Error(
            `Câu ${i + 1} cần tốc độ ${speed.toFixed(2)}× vượt giới hạn ${c.maxSpeed}×. Rút gọn bản dịch hoặc kéo dài thời gian câu.`,
          );
        const name = `fit-${i}.wav`;
        await cmd(c.ffmpeg, [
          "-y",
          "-i",
          raw,
          "-af",
          `atempo=${speed.toFixed(5)},apad,atrim=duration=${available.toFixed(3)}`,
          "-ar",
          "24000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          path.join("tts", name),
        ]);
        parts.push(name);
        cursor = q.end;
        store.patch(id, {
          progress: 78 + Math.round((8 * (i + 1)) / segments.length),
        });
      }
      if (cursor < duration) {
        const name = "tail.wav";
        await cmd(c.ffmpeg, [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=24000:cl=mono",
          "-t",
          (duration - cursor).toFixed(3),
          "-c:a",
          "pcm_s16le",
          path.join("tts", name),
        ]);
        parts.push(name);
      }
      await fs.writeFile(
        path.join(dir, "tts", "concat.txt"),
        parts.map((f) => `file '${f}'`).join("\n"),
      );
      await cmd(c.ffmpeg, [
        "-y",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        "tts/concat.txt",
        "-c:a",
        "pcm_s16le",
        "dub.wav",
      ]);
      dubFile = "dub.wav";
    }
    stage("Ghép hình, phụ đề và âm thanh", 88);
    const filter = this.filters(o, media, Boolean(dubFile));
    await fs.writeFile(path.join(dir, "render-filter.txt"), filter.graph);
    const args = [
      "-y",
      "-i",
      source,
      ...(dubFile ? ["-i", dubFile] : []),
      "-filter_complex",
      filter.graph,
      "-map",
      "[vout]",
      ...filter.audio,
      "-c:v",
      o.encoder,
      ...(o.encoder === "libx264"
        ? ["-preset", "medium", "-crf", "20"]
        : ["-quality", "quality", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-t",
      duration.toFixed(3),
      "-movflags",
      "+faststart",
      "output.pending.mp4",
    ];
    let renderTick = performance.now(), renderOutput = "";
    await cmd(c.ffmpeg, ["-progress", "pipe:1", "-nostats", ...args], { timeout: 12 * 3600000,
      onLine: text => {
        renderOutput = (renderOutput + text).slice(-8000);
        const matches = [...renderOutput.matchAll(/out_time_us=(\d+)\r?\n/g)];
        if (!matches.length) return;
        const done = Math.min(duration, Number(matches.at(-1)[1]) / 1e6), now = performance.now();
        recordStage(store, id, "render", done, duration, now - renderTick, done >= duration);
        renderTick = now; renderOutput = "";
        store.patch(id, { progress: Math.round(100 * done / duration), stage: `Xuất video ${done.toFixed(1)}/${duration.toFixed(1)} giây` });
      } });
    await fs.rename(
      path.join(dir, "output.pending.mp4"),
      path.join(dir, "output.mp4"),
    );
    recordStage(store, id, "render", duration, duration, 0, true);
    store.patch(id, {
      status: "completed",
      progress: 100,
      stage: "Xuất video hoàn tất",
      output: "output.mp4",
      outputRevision: store.episode(id).revision,
    });
    store.log(id, "Đã xuất MP4 và phụ đề SRT.");
  }
  async translate(cues, o, c, signal, progress, id) {
    return translateContext(this.store, cues, o, c, signal, progress, id);
  }
  async streamAsr({ id, source, duration, c, o, dir, signal }) {
    const store = this.store;
    await withProvider(c, signal, async () => {
      await boundedPipeline(
        sig => recognizeChunks({ store, id, source, duration, c, dir, signal: sig }),
        async (_chunk, sig) => {
          const e = store.episode(id);
          const ready = e.asrManifest.complete ? e.cues : e.cues.slice(0, Math.max(0, e.cues.length - 2));
          if (ready.length) await this.translateEpisode(ready, o, c, sig, id, { session: true, review: false });
        }, { signal, parallel: () => { const plan = resourcePlan(c); store.patch(id, { resourcePlan: plan }); return plan.parallel; } });
      await this.translateEpisode(store.episode(id).cues, o, c, signal, id, { session: true });
      const current = store.episode(id);
      recordStage(store, id, "translation", current.cues.filter(q => q.vi).length, current.cues.length, 0, true);
    }, m => store.log(id, m));
  }
  async translateEpisode(cues, o, c, signal, id, { session = false, review = true } = {}) {
    const store = this.store;
    let result = reuseMemory(store, store.episode(id), cues);
    mergeTranslations(store, id, cues, result);
    const runTranslation = async () => {
      if (result.some((q) => !q.vi?.trim())) {
        if (c.translationEngine === "opus")
          result = await translateOpus(result, c, {
            root: this.root,
            dir: store.episodeDir(id),
            signal,
            store,
            id,
          });
        else
          result = await this.translate(
            result,
            o,
            c,
            signal,
            (done, total) =>
              store.patch(id, {
                progress: 40 + Math.round((20 * done) / total),
                stage: `Dịch ${done}/${total} câu`,
              }),
            id,
          );
      }
      mergeTranslations(store, id, cues, result);
      const current = store.episode(id);
      if (
        review && c.autoReview &&
        !(
          current.quality?.status === "complete" &&
          current.quality.fingerprint === qualityFingerprint(store, current) &&
          hash(current.quality.model) === hash(providerIdentity(c))
        )
      ) {
        store.patch(id, { stage: "Kiểm tra chất lượng bản dịch" });
        await reviewTranslation(store, id, c, signal, (done, total) =>
          store.patch(id, {
            stage: `Kiểm tra ${done}/${total} câu`,
            progress: 60 + Math.round((5 * done) / total),
          }),
        );
      }
      return store.episode(id).cues;
    };
    if (session) return runTranslation();
    return withProvider(c, signal, runTranslation, (m) => store.log(id, m));
  }
  filters(o, m, dub) {
    let graph = "",
      input = "0:v";
    const x = Math.max(1, Math.round((m.width * o.roiX) / 100)),
      y = Math.max(1, Math.round((m.height * o.roiY) / 100)),
      w = Math.min(m.width - x - 1, Math.round((m.width * o.roiW) / 100)),
      h = Math.min(m.height - y - 1, Math.round((m.height * o.roiH) / 100));
    if (o.cover === "blur") {
      graph += `[0:v]split[base][crop];[crop]crop=${w}:${h}:${x}:${y},boxblur=10:2[blur];[base][blur]overlay=${x}:${y}[covered];`;
      input = "covered";
    }
    if (o.cover === "box") {
      graph += `[0:v]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=black@0.9:t=fill[covered];`;
      input = "covered";
    }
    if (o.cover === "delogo") {
      graph += `[0:v]delogo=x=${x}:y=${y}:w=${w}:h=${h}[covered];`;
      input = "covered";
    }
    const height = Math.floor(Math.min(m.height, o.outputHeight) / 2) * 2;
    graph += `[${input}]scale=-2:${height},setsar=1${o.burn ? ",ass=filename=vietnamese.ass" : ""}[vout]`;
    let audio = [];
    if (dub && m.hasAudio && o.originalVolume > 0) {
      graph += `;[0:a]volume=${o.originalVolume}[original];[original][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[aout]`;
      audio = ["-map", "[aout]"];
    } else if (dub) audio = ["-map", "1:a:0"];
    else if (m.hasAudio) audio = ["-map", "0:a:0"];
    return { graph, audio };
  }
}

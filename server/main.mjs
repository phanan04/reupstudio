import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { pipeline as streamPipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, defaults } from "./store.mjs";
import { loadEnvironment, dataDirectory, localDefaults, runtimeSettings, portableSettings } from "./runtime.mjs";
import { Pipeline } from "./pipeline.mjs";
import { blockedReason } from "./llm.mjs";
import { remoteEndpoint, providerHealth } from "./ai-provider.mjs";
import {
  getKnowledge,
  putKnowledge,
  approvalState,
  approveCues,
  memories,
  retrieve,
  orderOf,
} from "./knowledge.mjs";
import { qualityFingerprint } from "./translation.mjs";
import { opusRuntime } from "./opus-runtime.mjs";
import { editCuePatch } from "./cue-merge.mjs";
import { lockData } from "./data-lock.mjs";
import {
  validateUrl,
  localEndpoint,
  validateCues,
  parseSubtitles,
  options,
  run,
  srt,
} from "./core.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvironment(root);
lockData(dataDirectory(root));
const port = Number(process.env.PORT || 8765),
  store = new Store(dataDirectory(root), localDefaults(root)),
  worker = new Pipeline(store, root);
const MAX_JSON = 8 * 1024 * 1024,
  MAX_UPLOAD = 20 * 1024 ** 3;
async function body(req) {
  let size = 0,
    chunks = [];
  for await (const b of req) {
    size += b.length;
    if (size > MAX_JSON) throw Error("Dữ liệu quá lớn");
    chunks.push(b);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function requiredEpisode(id) {
  const e = store.episode(id);
  if (!e) throw Error("Không tìm thấy tập");
  return e;
}
function editable(e) {
  if (["running", "queued"].includes(e.status))
    throw Error("Dừng tác vụ trước khi chỉnh sửa tập");
}
function episodeDetail(e) {
  return {
    ...e,
    order: orderOf(store, e),
    approvedIds: approvalState(store, e),
    qualityStale:
      !!e.quality && e.quality.fingerprint !== qualityFingerprint(store, e),
    logs: store.logs(e.id),
  };
}
function state() {
  return {
    translationEngine: store.settings().translationEngine,
    series: store.listSeries(),
    episodes: store
      .episodes()
      .map(({ cues, quality, probeInfo, asrManifest, ...e }) => ({
        ...e,
        cueCount: cues.length,
        qualityStatus: quality?.status,
      })),
    active: worker.active?.id || null,
    pending: worker.pending.length,
  };
}
async function health() {
  const c = runtimeSettings(store.settings(), root);
  const specs = [
    ["ffmpeg", c.ffmpeg, ["-version"]],
    ["ffprobe", c.ffprobe, ["-version"]],
    ["yt-dlp", c.ytdlp, ["--version"]],
    ["Whisper", c.whisper, ["--help"]],
    ["Piper", c.python, ["-c", 'import piper; print("Piper available")']],
    ["OCR", c.python, ["-c", 'import rapidocr; print("RapidOCR available")']],
  ];
  const result = await Promise.all(
    specs.map(async ([name, bin, args]) => {
      try {
        await run(bin, args, { timeout: 20000 });
        return { name, ok: true, detail: bin };
      } catch (e) {
        return { name, ok: false, detail: e.message };
      }
    }),
  );
  result.push({
    name: "Whisper model",
    ok: !!c.whisperModel && existsSync(c.whisperModel),
    detail: c.whisperModel || "Chưa cài mô hình",
  });
  let voices = [];
  try {
    voices = (await fs.readdir(c.voicesDir)).filter((f) =>
      /^vi_VN.*\.onnx$/.test(f),
    );
  } catch {}
  result.push({
    name: "Giọng tiếng Việt",
    ok: voices.length > 0,
    detail: voices.join(", ") || "Chưa có giọng Piper",
  });
  if (c.translationEngine === "opus") {
    if (opusRuntime() === "docker") {
      try {
        await run("docker", ["image", "inspect", "vietstudio-opus:local"], { timeout: 15000 });
        result.push({ name: "OPUS Docker CPU", ok: true, detail: "Image sẵn sàng; chưa xác nhận suy luận. Model được mount chỉ đọc, không dùng mạng khi dịch." });
      } catch {
        result.push({ name: "OPUS Docker CPU", ok: false, detail: "Mở Docker Desktop rồi chạy docker compose build opus." });
      }
    }
    result.push({
      name: "AI dịch CPU · OPUS",
      ok:
        !!c.opusModel &&
        existsSync(path.join(c.opusModel, "pytorch_model.bin")),
      detail:
        "Dịch từng câu, cần duyệt. Không dùng ngữ cảnh/thuật ngữ của LLM.",
    });
  } else if (["ollama", "api"].includes(c.translationEngine)) {
    try {
      result.push(await providerHealth(c));
    } catch (e) {
      result.push({ name: "AI", ok: false, detail: e.message });
    }
  } else if (c.managedLlm) {
    const reason = c.llama ? blockedReason(c.llama) : "";
    result.push({
      name: "AI dịch local",
      ok:
        !reason &&
        !!c.llama &&
        existsSync(c.llama) &&
        !!c.llamaModel &&
        existsSync(c.llamaModel),
      detail:
        reason ||
        "Tự nạp khi dịch; kiểm tra sự hiện diện của tệp, chưa chứng nhận suy luận.",
    });
  } else
    try {
      const r = await fetch(localEndpoint(c.llmUrl) + "/models", {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw Error("HTTP " + r.status);
      result.push({ name: "AI dịch local", ok: true, detail: c.llmUrl });
    } catch (e) {
      result.push({ name: "AI dịch local", ok: false, detail: e.message });
    }
  try {
    const enc = await run(c.ffmpeg, ["-hide_banner", "-encoders"], {
      timeout: 10000,
    });
    result.push({
      name: "AMD AMF encoder",
      ok: enc.includes("h264_amf"),
      detail:
        "Có encoder không đồng nghĩa driver đã hoạt động; xác nhận bằng lần xuất thực tế.",
    });
  } catch {}
  return { checks: result, voices: voices.map((v) => v.slice(0, -5)) };
}
async function serveFile(req, res, file, type) {
  const stat = await fs.stat(file);
  let start = 0,
    end = stat.size - 1;
  const range = req.headers.range;
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (!m[1] && !m[2])) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
    if (!m[1]) start = Math.max(0, stat.size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      return res.end();
    }
  }
  res.writeHead(range ? 206 : 200, {
    "Content-Type": type,
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
  });
  if (req.method === "HEAD") return res.end();
  await streamPipeline(createReadStream(file, { start, end }), res);
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    const expected = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!expected.has(req.headers.host))
      return json(res, { error: "Host không hợp lệ" }, 403);
    if (req.headers.origin && !expected.has(new URL(req.headers.origin).host))
      return json(res, { error: "Origin không hợp lệ" }, 403);
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["x-vietstudio"] !== "1"
    )
      return json(res, { error: "Thiếu xác thực same-origin" }, 403);
    const url = new URL(req.url, `http://127.0.0.1:${port}`),
      route = url.pathname;
    if (route === "/api/state" && req.method === "GET")
      return json(res, state());
    if (route === "/api/settings" && req.method === "GET")
      return json(res, store.settings());
    if (route === "/api/settings" && req.method === "PUT") {
      if (worker.active || worker.pending.length)
        throw Error("Dừng hàng đợi trước khi đổi công cụ");
      const b = await body(req),
        c = { ...store.settings() };
      for (const k of Object.keys(defaults)) {
        if (b[k] !== undefined) c[k] = b[k];
      }
      for (const k of [
        "ffmpeg",
        "ffprobe",
        "ytdlp",
        "whisper",
        "python",
        "whisperVadModel",
        "whisperModel",
        "voicesDir",
        "cookies",
        "llmModel",
        "llama",
        "llamaModel",
        "opusModel",
      ]) {
        if (
          typeof c[k] !== "string" ||
          c[k].length > 2048 ||
          c[k].includes("\0")
        )
          throw Error("Đường dẫn không hợp lệ");
      }
      if (!["llm", "opus", "ollama", "api"].includes(c.translationEngine))
        throw Error("Bộ dịch không hợp lệ");
      c.llmUrl = localEndpoint(c.llmUrl);
      c.ollamaUrl = localEndpoint(c.ollamaUrl);
      c.apiUrl = remoteEndpoint(c.apiUrl);
      for (const key of ["ollamaModel", "apiModel", "apiKeyEnv"])
        if (typeof c[key] !== "string" || c[key].length > 200)
          throw Error("Cấu hình AI không hợp lệ");
      if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(c.apiKeyEnv))
        throw Error("Tên biến môi trường API không hợp lệ");
      for (const key of [
        "forceCpu",
        "cpuFallback",
        "allowRemote",
        "autoReview",
      ])
        if (typeof c[key] !== "boolean")
          throw Error("Thiết lập AI bật/tắt không hợp lệ");
      for (const [k, min, max] of [
        ["threads", 1, 32],
        ["batchSize", 1, 40],
        ["maxSpeed", 1, 2],
        ["gpuLayers", 0, 99],
        ["contextSize", 2048, 16384],
      ]) {
        c[k] = Number(c[k]);
        if (
          !Number.isFinite(c[k]) ||
          c[k] < min ||
          c[k] > max ||
          (k !== "maxSpeed" && !Number.isInteger(c[k]))
        )
          throw Error(`Giá trị ${k} không hợp lệ`);
      }
      c.ocrDirectML = Boolean(c.ocrDirectML);
      c.managedLlm = Boolean(c.managedLlm);
      store.saveSettings(portableSettings(c, root));
      return json(res, store.settings());
    }
    if (route === "/api/health" && req.method === "GET")
      return json(res, await health());
    if (route === "/api/subtitle-project" && req.method === "POST") {
      const b = await body(req);
      if (!store.series(b.seriesId))
        throw Error("Chọn dự án trước khi nhập phụ đề");
      const cues = parseSubtitles(String(b.content || ""));
      return json(
        res,
        episodeDetail(
          store.addEpisode(b.seriesId, {
            title: String(b.title || "Phụ đề CapCut").slice(0, 200),
            cues,
            manualCues: true,
            subtitleOnly: true,
            stage: "Phụ đề gốc đã nhập · sẵn sàng dịch",
          }),
        ),
        201,
      );
    }
    if (route === "/api/series" && req.method === "POST") {
      const b = await body(req);
      return json(
        res,
        store.createSeries(
          String(b.title || "Series mới")
            .trim()
            .slice(0, 200),
        ),
        201,
      );
    }
    let match = route.match(/^\/api\/series\/([\w-]+)\/knowledge$/);
    if (match) {
      const seriesId = match[1];
      if (!store.series(seriesId)) throw Error("Không tìm thấy dự án");
      if (req.method === "GET") return json(res, getKnowledge(store, seriesId));
      if (req.method === "PUT") {
        store.episodes(seriesId).forEach(editable);
        const b = await body(req);
        return json(res, putKnowledge(store, seriesId, b, b.version));
      }
    }
    match = route.match(/^\/api\/series\/([\w-]+)$/);
    if (match && req.method === "DELETE") {
      store.trashSeries(match[1]);
      return json(res, {ok:true});
    }
    const restore = route.match(/^\/api\/series\/([\w-]+)\/restore$/);
    if (restore && req.method === "POST") {
      store.restoreSeries(restore[1]);
      return json(res, {ok:true});
    }
    if (route === "/api/trash" && req.method === "GET") {
      return json(res, store.db.prepare('SELECT s.id,s.title,d.deleted FROM series s JOIN deleted_series d ON s.id=d.id ORDER BY d.deleted DESC').all());
    }
    if (match && req.method === "PUT") {
      const s = store.series(match[1]);
      if (!s) throw Error("Không tìm thấy series");
      const b = await body(req);
      const active = store.episodes(s.id).filter(e => ["queued", "running"].includes(e.status));
      const changed = Object.keys(b.options || {}).filter(k => b.options[k] !== s.options[k]);
      if (active.length && (active.some(e => e.jobMode === "render") || changed.some(k => !["subtitleFont", "subtitleSize", "subtitleColor"].includes(k))))
        throw Error("Dừng series trước khi đổi thiết lập xử lý; vẫn có thể chỉnh kiểu chữ khi nhận diện/dịch");
      store.updateSeries(
        s.id,
        String(b.title || s.title).slice(0, 200),
        options(b.options || {}, s.options),
      );
      if (changed.length) for (const episode of store.episodes(s.id)) store.patch(episode.id, { outputRevision: null });
      return json(res, store.series(s.id));
    }
    if (route === "/api/inspect" && req.method === "POST") {
      const b = await body(req),
        source = validateUrl(b.url),
        j = await worker.inspect(source);
      const entries = (j.entries || [j]).filter(Boolean).map((e, i) => {
        let url = e.webpage_url || e.url;
        if (!url?.startsWith("http"))
          url = /^BV\w+$/.test(e.id)
            ? `https://www.bilibili.com/video/${e.id}`
            : source;
        try {
          url = validateUrl(url);
        } catch {
          url = source;
        }
        return {
          title: e.title || `Tập ${i + 1}`,
          url,
          duration: e.duration || null,
        };
      });
      return json(res, { title: j.title, entries });
    }
    if (route === "/api/import" && req.method === "POST") {
      const b = await body(req);
      if (
        !store.series(b.seriesId) ||
        !Array.isArray(b.entries) ||
        b.entries.length > 500
      )
        throw Error("Danh sách nhập không hợp lệ");
      const clean = b.entries.map((e) => ({
        title: String(e.title || "Video").slice(0, 250),
        url: validateUrl(e.url),
      }));
      const previous = store.episodes(b.seriesId);
      const added = [];
      for (const e of clean)
        if (
          !previous.some((p) => p.url === e.url) &&
          !added.some((p) => p.url === e.url)
        )
          added.push(store.addEpisode(b.seriesId, e));
      return json(res, { episodes: added }, 201);
    }
    if (route === "/api/upload" && req.method === "POST") {
      const seriesId = url.searchParams.get("seriesId"),
        name = path.basename(url.searchParams.get("name") || "video.mp4"),
        ext = path.extname(name).toLowerCase();
      if (
        !store.series(seriesId) ||
        ![".mp4", ".mkv", ".mov", ".webm", ".avi", ".flv", ".m4v"].includes(ext)
      )
        throw Error("Series hoặc định dạng không hợp lệ");
      const length = Number(req.headers["content-length"]);
      if (Number.isFinite(length) && length > MAX_UPLOAD)
        throw Error("Tệp vượt giới hạn 20 GB");
      const e = store.addEpisode(seriesId, {
          title: name,
          status: "uploading",
          stage: "Đang tải từ máy",
        }),
        dir = store.episodeDir(e.id);
      let size = 0;
      try {
        await streamPipeline(
          req,
          new Transform({
            transform(chunk, enc, cb) {
              size += chunk.length;
              if (size > MAX_UPLOAD) cb(Error("Tệp vượt 20 GB"));
              else cb(null, chunk);
            },
          }),
          createWriteStream(path.join(dir, "upload.part"), { flags: "wx" }),
        );
        if (!size) throw Error("Tệp rỗng");
        await fs.rename(
          path.join(dir, "upload.part"),
          path.join(dir, "source" + ext),
        );
        const uploaded = store.patch(e.id, { source: "source" + ext, status: "idle", stage: "Đã nhập video" });
        worker.prepareUpload(e.id);
        return json(res, uploaded, 201);
      } catch (err) {
        store.patch(e.id, {
          status: "failed",
          error: err.message,
          stage: "Tải lên thất bại",
        });
        await fs.rm(path.join(dir, "upload.part"), { force: true });
        throw err;
      }
    }
    if (route === "/api/queue" && req.method === "POST") {
      const b = await body(req);
      if (
        !Array.isArray(b.ids) ||
        b.ids.length > 500 ||
        !["all", "render", "translate", "quality"].includes(b.mode || "all")
      )
        throw Error("Danh sách tập không hợp lệ");
      const ids = [...new Set(b.ids)];
      ids.forEach((id) => editable(requiredEpisode(id)));
      ids.sort(
        (a, b) =>
          orderOf(store, store.episode(a)) - orderOf(store, store.episode(b)),
      );
      ids.forEach((id) => worker.enqueue(id, b.mode || "all"));
      return json(res, { queued: ids.length });
    }
    match = route.match(
      /^\/api\/episodes\/([\w-]+)(?:\/(cues|subtitles|cancel|pause|resume|retry-issues|logs|reset-translation|approve|unapprove|memory|quality-apply|order))?$/,
    );
    if (match) {
      const id = match[1],
        action = match[2],
        e = requiredEpisode(id);
      if (!action && req.method === "GET") return json(res, episodeDetail(e));
      if (action === "retry-issues" && req.method === "POST") {
        editable(e);
        if (!e.quality || e.quality.fingerprint !== qualityFingerprint(store, e)) throw Error("Kiểm tra chất lượng lại trước khi thử lại câu lỗi");
        const protectedIds = new Set([...approvalState(store, e), ...(e.userEditedIds || [])]);
        const issues = e.quality.issues.filter(q => ["missing", "untranslated", "meaning", "omission", "glossary", "name", "pronoun"].includes(q.type) && !protectedIds.has(q.id));
        const ids = new Set(issues.map(q => q.id));
        if (!ids.size) throw Error("Không có câu lỗi có thể dịch lại; các câu đã sửa/duyệt được bảo vệ");
        store.patch(id, { cues: e.cues.map(q => ids.has(q.id) ? { ...q, vi: "" } : q), revision: e.revision + 1,
          translationRetry: { nonce: Date.now(), issues } });
        worker.enqueue(id, "translate"); return json(res, { queued: ids.size });
      }
      if (action === "pause" && req.method === "POST") { worker.pause(id); return json(res, { ok: true }); }
      if (action === "resume" && req.method === "POST") { worker.resume(id); return json(res, { ok: true }); }
      if (action === "cues" && req.method === "PATCH") {
        const b = await body(req);
        const e = requiredEpisode(id);
        if (["running", "queued"].includes(e.status) && e.jobMode === "render") throw Error("Đợi xuất xong trước khi sửa");
        try {
          const cues = editCuePatch(e.cues, b.updates);
          return json(res, episodeDetail(store.patch(id, { cues, manualCues: true, revision: e.revision + 1, userEditedIds: [...new Set([...(e.userEditedIds || []), ...b.updates.map(q => q.id)])] })));
        } catch (error) { if (error.status === 409) return json(res, { error: error.message }, 409); throw error; }
      }
      if (action === "memory" && req.method === "GET") {
        return json(res, {
          entries: memories(store, e).slice(-300),
          evidence: retrieve(store, e, e.cues.slice(0, 8)),
        });
      }
      if (
        ["approve", "unapprove", "quality-apply", "order"].includes(action) &&
        req.method === "POST"
      ) {
        editable(e);
        const b = await body(req);
        if (b.revision !== e.revision)
          return json(
            res,
            { error: "Phụ đề đã thay đổi. Mở lại trước khi duyệt." },
            409,
          );
        if (action === "approve") approveCues(store, e, b.ids);
        if (action === "unapprove") {
          if (
            !Array.isArray(b.ids) ||
            b.ids.some((c) => !e.cues.some((q) => q.id === c))
          )
            throw Error("Danh sách câu không hợp lệ");
          for (const cueId of b.ids) {
            store.db
              .prepare("DELETE FROM approvals WHERE episode_id=? AND cue_id=?")
              .run(id, cueId);
            store.db
              .prepare(
                "DELETE FROM translation_memory WHERE episode_id=? AND cue_id=?",
              )
              .run(id, cueId);
          }
        }
        if (action === "quality-apply") {
          if (
            !e.quality ||
            e.quality.fingerprint !== qualityFingerprint(store, e)
          )
            throw Error("Kết quả kiểm tra đã cũ. Chạy kiểm tra lại.");
          const issue = e.quality.issues[b.issueIndex];
          if (!issue?.suggestion || issue.source !== "ai")
            throw Error("Không có đề xuất để áp dụng");
          store.patch(id, {
            cues: e.cues.map((c) =>
              c.id === issue.id ? { ...c, vi: issue.suggestion } : c,
            ),
            manualCues: true,
            revision: e.revision + 1,
          });
        }
        if (action === "order") {
          store.episodes(e.seriesId).forEach(editable);
          if (!Number.isInteger(b.order) || b.order < 1 || b.order > 10000)
            throw Error("Thứ tự tập không hợp lệ");
          const other = store
            .episodes(e.seriesId)
            .find((x) => x.id !== id && orderOf(store, x) === b.order);
          store.db.exec("BEGIN IMMEDIATE");
          try {
            if (other) store.patch(other.id, { order: orderOf(store, e) });
            store.patch(id, { order: b.order });
            store.db.exec("COMMIT");
          } catch (err) {
            store.db.exec("ROLLBACK");
            throw err;
          }
        }
        return json(res, episodeDetail(store.episode(id)));
      }
      if (action === "cancel" && req.method === "POST") {
        worker.cancel(id);
        return json(res, { ok: true });
      }
      if (action === "logs" && req.method === "GET")
        return json(res, store.logs(id));
      if (action === "reset-translation" && req.method === "POST") {
        editable(e);
        const approved = approvalState(store, e);
        return json(
          res,
          store.patch(id, {
            cues: e.cues.map((c) =>
              approved.includes(c.id) ? c : { ...c, vi: "" },
            ),
            revision: e.revision + 1,
          }),
        );
      }
      if (action === "cues" && req.method === "PUT") {
        const b = await body(req);
        const e = requiredEpisode(id);
        editable(e);
        if (b.revision !== e.revision)
          return json(
            res,
            { error: "Phụ đề đã thay đổi. Tải lại trước khi lưu." },
            409,
          );
        return json(
          res,
          episodeDetail(
            store.patch(id, {
              cues: validateCues(b.cues),
              userEditedIds: [...new Set([...(e.userEditedIds || []), ...b.cues.filter(q => JSON.stringify(q) !== JSON.stringify(e.cues.find(old => old.id === q.id))).map(q => q.id)])],
              manualCues: true,
              revision: e.revision + 1,
            }),
          ),
        );
      }
      if (action === "subtitles" && req.method === "POST") {
        editable(e);
        const b = await body(req),
          cues = parseSubtitles(String(b.content || ""));
        if (b.language === "vi")
          cues.forEach((c) => {
            c.vi = c.text;
            c.text = "";
          });
        return json(
          res,
          store.patch(id, { cues, manualCues: true, revision: e.revision + 1 }),
        );
      }
    }
    match = route.match(/^\/media\/([\w-]+)\/(source|output|subtitles)$/);
    if (match && ["GET", "HEAD"].includes(req.method)) {
      const e = requiredEpisode(match[1]),
        kind = match[2],
        dir = store.episodeDir(e.id);
      if (kind === "subtitles") {
        if ((e.asrManifest && !e.asrManifest.complete) || !e.cues.length || e.cues.some(c=>!c.vi?.trim())) throw Error('Còn câu chưa dịch. Hoàn tất bản Việt trước khi tải SRT.');
        res.writeHead(200, {
          "Content-Type": "application/x-subrip; charset=utf-8",
          "Content-Disposition": 'attachment; filename="vietnamese.srt"',
        });
        return res.end(srt(e.cues));
      }
      const name = e[kind];
      if (!name || path.basename(name) !== name)
        return json(res, { error: "Chưa có tệp" }, 404);
      if (kind === "output")
        res.setHeader(
          "Content-Disposition",
          url.searchParams.has("download")
            ? 'attachment; filename="vietnamese.mp4"'
            : "inline",
        );
      return await serveFile(
        req,
        res,
        path.join(dir, name),
        name.endsWith(".webm")
          ? "video/webm"
          : name.endsWith(".mkv")
            ? "video/x-matroska"
            : "video/mp4",
      );
    }
    if (route.startsWith("/api/"))
      return json(res, { error: "Không tìm thấy API" }, 404);
    const assets = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/style.css": ["style.css", "text/css"],
      "/app.js": ["app.js", "text/javascript"],
      "/favicon.svg": ["favicon.svg", "image/svg+xml"],
    };
    if (assets[route] && ["GET", "HEAD"].includes(req.method)) {
      const [name, type] = assets[route];
      return await serveFile(req, res, path.join(root, "public", name), type);
    }
    json(res, { error: "Không tìm thấy" }, 404);
  } catch (err) {
    if (!res.headersSent) json(res, { error: err.message }, 400);
    else res.destroy();
  }
});
server.requestTimeout = 0;
server.listen(port, "127.0.0.1", () =>
  console.log(`Việt Studio: http://127.0.0.1:${port}`),
);
function stop() {
  worker.pending = [];
  worker.active?.controller.abort();
  worker.prepareController.abort();
  server.close(async () => {
    await worker.prepareTail;
    while (worker.active) await new Promise(resolve => setTimeout(resolve, 20));
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

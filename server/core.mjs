import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
export const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function validateUrl(value) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw Error("Chỉ chấp nhận URL HTTPS Bilibili/Douyin");
  const hosts = ["bilibili.com", "b23.tv", "douyin.com", "iesdouyin.com"];
  if (!hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h)))
    throw Error("URL phải thuộc Bilibili hoặc Douyin");
  return u.href;
}
export function localEndpoint(value) {
  const u = new URL(value);
  if (
    u.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error("Máy chủ AI phải là HTTP localhost");
  return u.href.replace(/\/$/, "");
}
export function run(
  bin,
  args,
  {
    cwd,
    signal,
    input,
    timeout = 3600000,
    maxOutput = 8 * 1024 * 1024,
    onLine,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error("Đã hủy"));
    const child = spawn(bin, args.map(String), {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "",
      settled = false,
      stopping = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    const stop = (error) => {
      if (stopping || settled) return;
      stopping = error;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
        killer.on("close", () => child.kill());
      } else child.kill();
    };
    const abort = () => stop(Error("Đã hủy"));
    const timer = setTimeout(
      () => stop(Error(`Hết thời gian chạy ${bin}`)),
      timeout,
    );
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (e) =>
      finish(Error(`Không chạy được ${bin}: ${e.message}`)),
    );
    child.stdout.on("data", (b) => {
      if (stopping) return;
      out += b;
      if (out.length > maxOutput) stop(Error("Kết quả công cụ vượt giới hạn"));
      onLine?.(String(b));
    });
    child.stderr.on("data", (b) => {
      err = (err + b).slice(-24000);
      onLine?.(String(b));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("close", (code) => {
      let message = `${bin} kết thúc mã ${code}: ${err.slice(-2200)}`;
      if (code >>> 0 === 0xc0e90002)
        message =
          "Windows Code Integrity chặn thư viện của công cụ (0xC0E90002). Cần runtime được cho phép hoặc chọn bộ xử lý khác.";
      if (/Fresh cookies|cookies.*needed/i.test(err))
        message =
          "Douyin yêu cầu cookies mới. Xuất cookies của phiên trình duyệt thành tệp Netscape, rồi chọn tệp trong Cấu hình máy. " +
          err.slice(-500);
      finish(stopping || (code === 0 ? null : Error(message)), out);
    });
  });
}
export function timestamp(seconds, ass = false) {
  let ms = Math.round(Math.max(0, seconds) * (ass ? 100 : 1000));
  const base = ass ? 100 : 1000;
  const h = Math.floor(ms / (3600 * base));
  ms %= 3600 * base;
  const m = Math.floor(ms / (60 * base));
  ms %= 60 * base;
  const s = Math.floor(ms / base);
  const f = ms % base;
  return `${ass ? h : String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${ass ? "." : ","}${String(f).padStart(ass ? 2 : 3, "0")}`;
}
export function seconds(s) {
  const parts = String(s).replace(",", ".").split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n)))
    throw Error("Mốc thời gian không hợp lệ");
  return parts.reduce((a, n) => a * 60 + n, 0);
}
export function validateCues(cues) {
  if (!Array.isArray(cues) || cues.length > 20000)
    throw Error("Danh sách phụ đề không hợp lệ");
  let prev = -1;
  const ids = new Set(cues.filter(c => c.id !== undefined).map(c => String(c.id)));
  const seen = new Set();
  let nextId = 1;
  return cues.map((c, i) => {
    while (ids.has(String(nextId)) || seen.has(String(nextId))) nextId++;
    const id = c.id === undefined ? String(nextId++) : String(c.id);
    if (!/^[\w-]{1,80}$/.test(id) || seen.has(id)) throw Error("ID phụ đề không hợp lệ hoặc bị trùng");
    seen.add(id);
    const start = Number(c.start),
      end = Number(c.end);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > 86400 ||
      start < prev
    )
      throw Error(`Thời gian câu ${i + 1} không hợp lệ hoặc chưa sắp xếp`);
    prev = start;
    const text = String(c.text ?? "").trim(),
      vi = String(c.vi ?? "").trim();
    if (text.length > 4000 || vi.length > 4000)
      throw Error("Câu phụ đề quá dài");
    const voice = String(c.voice || "");
    if (voice && !/^vi_VN-[\w-]+$/.test(voice))
      throw Error("Tên giọng không hợp lệ");
    const meta = {};
    for (const key of ["speaker", "listener", "scene"]) {
      if (c[key] !== undefined) {
        if (
          typeof c[key] !== "string" ||
          c[key].length > (key === "scene" ? 300 : 60)
        )
          throw Error("Thông tin nhân vật/cảnh không hợp lệ");
        meta[key] = c[key].trim();
      }
    }
    return { id, start, end, text, vi, voice, ...meta };
  });
}
export function parseSubtitles(content) {
  const text = content.replace(/^\uFEFF/, "").trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    const j = JSON.parse(text);
    return validateCues(
      (j.body || j.cues || j).map((c) => ({
        start: c.from ?? c.start,
        end: c.to ?? c.end,
        text: c.content ?? c.text,
        vi: c.vi,
        voice: c.voice,
      })),
    );
  }
  const result = [];
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)/,
    );
    if (!match) continue;
    const block = [];
    while (++i < lines.length && lines[i].trim()) block.push(lines[i]);
    result.push({
      start: seconds(match[1]),
      end: seconds(match[2]),
      text: block.join("\n").replace(/<[^>]*>/g, ""),
    });
  }
  if (!result.length) throw Error("Không đọc được phụ đề SRT/VTT/JSON");
  return validateCues(result);
}
export const srt = (cues) =>
  cues
    .map(
      (c, i) =>
        `${i + 1}\n${timestamp(c.start)} --> ${timestamp(c.end)}\n${c.vi || c.text}\n`,
    )
    .join("\n");
export function ass(cues, style = {}) {
  const font = ["Arial", "Times New Roman", "Verdana"].includes(style.subtitleFont) ? style.subtitleFont : "Arial";
  const size = Number.isFinite(style.subtitleSize) ? Math.max(24, Math.min(96, style.subtitleSize)) : 48;
  const hex = /^#[0-9a-f]{6}$/i.test(style.subtitleColor || "") ? style.subtitleColor.slice(1) : "FFFFFF";
  const color = hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2);
  const clean = (s) =>
    String(s)
      .replace(/[{}\\]/g, "")
      .replace(/\r?\n/g, "\\N");
  return (
    `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${size},&H00${color},&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1,2,90,90,55,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    cues
      .map(
        (c) =>
          `Dialogue: 0,${timestamp(c.start, true)},${timestamp(c.end, true)},Default,,0,0,0,,${clean(c.vi || c.text)}`,
      )
      .join("\n")
  );
}
export function options(raw, base) {
  const o = { ...base, ...raw };
  if (!["Arial", "Times New Roman", "Verdana"].includes(o.subtitleFont)) throw Error("Font không hợp lệ");
  if (!Number.isFinite(Number(o.subtitleSize)) || o.subtitleSize < 24 || o.subtitleSize > 96) throw Error("Cỡ chữ từ 24 đến 96");
  o.subtitleSize = Number(o.subtitleSize);
  if (!/^#[0-9a-f]{6}$/i.test(o.subtitleColor)) throw Error("Màu chữ không hợp lệ");
  for (const [key, allowed] of Object.entries({
    subtitleMode: ["auto", "whisper", "ocr", "manual"],
    style: ["natural", "drama", "technical"],
    cover: ["none", "blur", "box", "delogo"],
    encoder: ["libx264", "h264_amf"],
  }))
    if (!allowed.includes(o[key])) throw Error(`Thiết lập ${key} không hợp lệ`);
  for (const k of ["outputHeight", "downloadHeight"]) {
    o[k] = Number(o[k]);
    if (![480, 720, 1080, 1440, 2160].includes(o[k]))
      throw Error("Độ phân giải không hợp lệ");
  }
  for (const k of ["roiX", "roiY", "roiW", "roiH", "originalVolume"]) {
    o[k] = Number(o[k]);
    if (
      !Number.isFinite(o[k]) ||
      o[k] < 0 ||
      o[k] > (k === "originalVolume" ? 1 : 100)
    )
      throw Error("Vùng chọn hoặc âm lượng không hợp lệ");
  }
  if (
    o.roiW < 1 ||
    o.roiH < 1 ||
    o.roiX + o.roiW > 100 ||
    o.roiY + o.roiH > 100
  )
    throw Error("Vùng phụ đề nằm ngoài hình");
  for (const k of ["context", "glossary"]) {
    o[k] = String(o[k] || "");
    if (o[k].length > 10000) throw Error("Ngữ cảnh quá dài");
  }
  for (const k of ["dub", "burn", "review"])
    if (typeof o[k] !== "boolean")
      throw Error("Thiết lập bật/tắt không hợp lệ");
  if (!/^vi_VN-[\w-]+$/.test(o.voice)) throw Error("Giọng không hợp lệ");
  return o;
}

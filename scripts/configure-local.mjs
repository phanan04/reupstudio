import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaults } from "../server/store.mjs";
import { loadEnvironment, dataDirectory, localDefaults } from "../server/runtime.mjs";
import { assertDataIdle } from "../server/data-lock.mjs";
loadEnvironment();
const dir = dataDirectory(), file = path.join(dir, "studio.sqlite");
assertDataIdle(dir);
// Explicit reconfiguration only. Never construct Store or reset jobs here.
if (!fs.existsSync(file)) {
  console.log("Chưa có DB. Launcher sẽ tạo cấu hình tương đối khi khởi động lần đầu.");
} else {
  const db = new DatabaseSync(file);
  try {
    const active = db.prepare("SELECT data FROM episodes").all().some(r =>
      ["running", "queued", "uploading"].includes(JSON.parse(r.data).status));
    if (active) throw Error("Dừng hàng đợi và server trước khi cấu hình lại đường dẫn.");
    const current = JSON.parse(db.prepare("SELECT data FROM settings WHERE id=1").get().data);
    const detected = localDefaults();
    const next = { ...defaults, ...current };
    for (const key of ["ffmpeg", "ffprobe", "python", "ytdlp", "whisper", "llama", "whisperModel", "llamaModel", "opusModel", "voicesDir"])
      next[key] = detected[key];
    if (process.argv.includes("--cpu")) next.forceCpu = true;
    fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
    const backup = path.join(dir, "backups", `before-configure-${Date.now()}.sqlite`);
    db.exec("VACUUM INTO '" + backup.replaceAll("'", "''") + "'");
    db.prepare("UPDATE settings SET data=? WHERE id=1").run(JSON.stringify(next));
    console.log("Đã sao lưu DB và cập nhật đường dẫn tương đối. Giữ nguyên bộ dịch và dữ liệu.");
  } finally { db.close(); }
}

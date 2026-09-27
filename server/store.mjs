import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { initKnowledge } from "./knowledge.mjs";
export const defaults = {
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
  ytdlp: "yt-dlp",
  whisper: "whisper-cli",
  python: "python",
  whisperModel: "",
  whisperVadModel: "./models/ggml-silero-v6.2.0.bin",
  llmUrl: "http://127.0.0.1:8081/v1",
  llmModel: "local",
  translationEngine: "llm",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen3:4b-instruct",
  apiUrl: "https://api.example.com/v1",
  apiModel: "",
  apiKeyEnv: "VIETSTUDIO_AI_KEY",
  allowRemote: false,
  contextSize: 4096,
  forceCpu: false,
  cpuFallback: true,
  autoReview: true,
  opusModel: "",
  llama: "",
  llamaModel: "",
  managedLlm: true,
  gpuLayers: 99,
  voicesDir: "",
  cookies: "",
  ocrDirectML: false,
  threads: 4,
  batchSize: 12,
  maxSpeed: 1.35,
};
export const optionDefaults = {
  subtitleMode: "auto",
  downloadHeight: 1080,
  outputHeight: 1080,
  style: "natural",
  context: "",
  glossary: "",
  dub: true,
  voice: "vi_VN-vais1000-medium",
  originalVolume: 0.12,
  cover: "none",
  roiX: 5,
  roiY: 78,
  roiW: 90,
  roiH: 17,
  burn: true,
  encoder: "libx264",
  review: true,
  subtitleFont: "Arial", subtitleSize: 48, subtitleColor: "#FFFFFF",
};
export class Store {
  constructor(dir, initialSettings = {}) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "studio.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS series(id TEXT PRIMARY KEY,title TEXT NOT NULL,options TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES series(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,episode_id TEXT,message TEXT,time TEXT);
 CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    initKnowledge(this.db);
    this.db.exec('CREATE TABLE IF NOT EXISTS deleted_series(id TEXT PRIMARY KEY, deleted TEXT NOT NULL)');
    this.db
      .prepare("INSERT OR IGNORE INTO settings VALUES(1,?)")
      .run(JSON.stringify({ ...defaults, ...initialSettings }));
    if (!this.listSeries().length) this.createSeries("Series đầu tiên");
    for (const e of this.episodes())
      if (["running", "queued", "uploading"].includes(e.status))
        this.patch(e.id, {
          status: "interrupted",
          stage: "Đã dừng do khởi động lại. Có thể chạy tiếp.",
        });
  }
  settings() {
    return {
      ...defaults,
      ...JSON.parse(
        this.db.prepare("SELECT data FROM settings WHERE id=1").get().data,
      ),
    };
  }
  saveSettings(data) {
    this.db
      .prepare("UPDATE settings SET data=? WHERE id=1")
      .run(JSON.stringify(data));
  }
  listSeries() {
    return this.db
      .prepare("SELECT * FROM series WHERE id NOT IN (SELECT id FROM deleted_series) ORDER BY created DESC")
      .all()
      .map((s) => ({ ...s, options: { ...optionDefaults, ...JSON.parse(s.options) } }));
  }
  series(id) {
    return this.listSeries().find((s) => s.id === id);
  }
  trashSeries(id) {
    if (!this.series(id)) throw Error("Không tìm thấy dự án");
    if (this.episodes(id).some(e => ["running", "queued", "uploading"].includes(e.status)))
      throw Error("Dừng xử lý và đợi tải lên hoàn tất trước khi xóa dự án.");
    this.db.prepare('INSERT INTO deleted_series VALUES(?,?)').run(id, new Date().toISOString());
    if (!this.listSeries().length) this.createSeries("Dự án mới");
  }
  restoreSeries(id) {
    this.db.prepare('DELETE FROM deleted_series WHERE id=?').run(id);
  }
  createSeries(title) {
    const s = {
      id: randomUUID(),
      title,
      options: { ...optionDefaults },
      created: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO series VALUES(?,?,?,?)")
      .run(s.id, s.title, JSON.stringify(s.options), s.created);
    return s;
  }
  updateSeries(id, title, options) {
    this.db
      .prepare("UPDATE series SET title=?,options=? WHERE id=?")
      .run(title, JSON.stringify(options), id);
  }
  episodes(seriesId) {
    return (
      seriesId
        ? this.db
            .prepare("SELECT data FROM episodes WHERE series_id=?")
            .all(seriesId)
        : this.db.prepare("SELECT data FROM episodes WHERE series_id NOT IN (SELECT id FROM deleted_series)").all()
    ).map((r) => JSON.parse(r.data));
  }
  episode(id) {
    const r = this.db.prepare("SELECT data FROM episodes WHERE id=?").get(id);
    const e = r ? JSON.parse(r.data) : null;
    return e && this.series(e.seriesId) ? e : null;
  }
  addEpisode(seriesId, data) {
    const e = {
      id: randomUUID(),
      seriesId,
      title: "Video",
      status: "idle",
      stage: "Chưa xử lý",
      progress: 0,
      cues: [],
      revision: 0,
      order: this.episodes(seriesId).length + 1,
      created: new Date().toISOString(),
      ...data,
    };
    this.db
      .prepare("INSERT INTO episodes VALUES(?,?,?)")
      .run(e.id, seriesId, JSON.stringify(e));
    fs.mkdirSync(this.episodeDir(e.id), { recursive: true });
    return e;
  }
  patch(id, patch) {
    const e = this.episode(id);
    if (!e) throw Error("Không tìm thấy tập");
    Object.assign(e, patch);
    this.db
      .prepare("UPDATE episodes SET data=? WHERE id=?")
      .run(JSON.stringify(e), id);
    return e;
  }
  episodeDir(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("ID không hợp lệ");
    return path.join(this.dir, "episodes", id);
  }
  log(id, message) {
    this.db
      .prepare("INSERT INTO logs(episode_id,message,time) VALUES(?,?,?)")
      .run(id, String(message).slice(-4000), new Date().toISOString());
    this.db
      .prepare("DELETE FROM logs WHERE id < (SELECT MAX(id)-10000 FROM logs)")
      .run();
  }
  logs(id) {
    return (
      id
        ? this.db
            .prepare(
              "SELECT * FROM logs WHERE episode_id=? ORDER BY id DESC LIMIT 100",
            )
            .all(id)
        : this.db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 100").all()
    ).reverse();
  }
  cached(key, value) {
    if (value !== undefined)
      this.db
        .prepare("INSERT OR REPLACE INTO cache VALUES(?,?)")
        .run(key, JSON.stringify(value));
    else {
      const row = this.db
        .prepare("SELECT value FROM cache WHERE key=?")
        .get(key);
      return row ? JSON.parse(row.value) : null;
    }
  }
  close() {
    this.db.close();
  }
}

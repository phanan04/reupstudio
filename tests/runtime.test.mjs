import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { projectRoot, portableSettings, runtimeSettings, localDefaults } from "../server/runtime.mjs";
import { lockData, assertDataIdle } from "../server/data-lock.mjs";
import { opusCommand, opusRuntime } from "../server/opus-runtime.mjs";

function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), "vietstudio portable ")); }

test("Project paths survive relocation and stay independent of episode cwd", () => {
  const root = fixture();
  try {
    const stored = portableSettings({ python: path.join(root, ".venv/bin/python"), opusModel: path.join(root, "models/opus"), ffmpeg: "ffmpeg", cookies: "" }, root);
    assert.equal(stored.python, "./.venv/bin/python");
    assert.equal(stored.opusModel, "./models/opus");
    const moved = path.join(root, "moved checkout");
    const runtime = runtimeSettings(stored, moved);
    assert.equal(runtime.python, path.join(moved, ".venv/bin/python"));
    assert.equal(runtime.opusModel, path.join(moved, "models/opus"));
    assert.equal(runtime.ffmpeg, "ffmpeg");
    assert.equal(runtime.cookies, "");
    assert.equal(stored.python, "./.venv/bin/python");
    fs.mkdirSync(path.join(root, ".venv/Scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, ".venv/Scripts/python.exe"), "fixture");
    assert.equal(localDefaults(root, "win32").python, "./.venv/Scripts/python.exe");
    assert.equal(localDefaults(root, "darwin").python, "python3");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Database ownership refuses a second server without touching running jobs", () => {
  const root = fixture();
  try {
    const release = lockData(root);
    assert.throws(() => lockData(root), /server/);
    assert.throws(() => assertDataIdle(root), /server/);
    release();
    assert.doesNotThrow(() => assertDataIdle(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("OPUS selects Intel Mac Docker and mounts only model and job without networking", () => {
  assert.equal(opusRuntime("darwin", "x64", "auto"), "docker");
  assert.equal(opusRuntime("darwin", "arm64", "auto"), "native");
  assert.equal(opusRuntime("win32", "x64", "auto"), "native");
  const root = path.resolve("checkout with spaces"), dir = path.join(root, "data/job");
  const c = { python: "python3", opusModel: path.join(root, "models/opus"), threads: 4 };
  const command = opusCommand(c, root, dir, "docker", "fixture-job");
  assert.equal(command.bin, "docker");
  assert.ok(command.args.includes("--network=none"));
  assert.ok(command.args.includes("--pull=never"));
  assert.ok(command.args.includes(`type=bind,source=${c.opusModel},target=/model,readonly`));
  assert.ok(command.args.includes(`type=bind,source=${dir},target=/job`));
  assert.equal(command.args.filter(x => x === "--mount").length, 2);
  const native = opusCommand(c, root, dir, "native");
  assert.equal(native.args[0], path.join(root, "workers/translate_opus.py"));
});

test("Environment file, native launcher, SQLite restart persistence and duplicate startup", { timeout: 30000 }, async () => {
  const root = fixture();
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const envfile = path.join(root, ".env");
  const data = path.join(root, "persistent data");
  fs.writeFileSync(envfile, `PORT=${port}\nVIETSTUDIO_DATA="${data.replaceAll("\\", "/")}"\n`);
  // Seed only a disposable DB to avoid starting a real Ollama instance.
  const { Store } = await import("../server/store.mjs");
  const store = new Store(data, { translationEngine: "opus" });
  store.close();
  const env = { ...process.env, VIETSTUDIO_ENV_FILE: envfile };
  delete env.PORT; delete env.VIETSTUDIO_DATA;
  let child;
  const start = async () => {
    child = spawn(process.execPath, [path.join(projectRoot, "scripts/start.mjs")], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(output || "startup timeout")), 15000);
      child.stderr.on("data", b => { output += b; });
      child.stdout.on("data", b => {
        output += b;
        if (output.includes(`http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
      });
      child.once("error", e => { clearTimeout(timer); reject(e); });
      child.once("exit", code => { clearTimeout(timer); reject(Error(`startup exit ${code}: ${output}`)); });
    });
  };
  const stop = async () => {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  };
  try {
    await start();
    const base = `http://127.0.0.1:${port}`;
    const r = await fetch(base + "/api/series", { method: "POST", headers: { "Content-Type": "application/json", "X-VietStudio": "1" }, body: JSON.stringify({ title: "Persistent fixture" }) });
    assert.equal(r.status, 201);
    const project = await r.json();
    const duplicate = spawn(process.execPath, [path.join(projectRoot, "scripts/start.mjs")], { cwd: root, env, stdio: "ignore" });
    const [code] = await once(duplicate, "exit");
    assert.notEqual(code, 0);
    assert.equal((await fetch(base + "/api/state")).status, 200);
    await stop();
    await start();
    const state = await (await fetch(base + "/api/state")).json();
    assert.ok(state.series.some(p => p.id === project.id));
  } finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("Explicit path migration backs up SQLite and preserves translations and provider", { timeout: 10000 }, async () => {
  const root = fixture(), data = path.join(root, "data");
  const { Store } = await import("../server/store.mjs");
  let store = new Store(data);
  try {
    store.saveSettings({ ...store.settings(), translationEngine: "opus", forceCpu: true, python: "obsolete-machine-python", cookies: "private-cookie-path" });
    const project = store.listSeries()[0];
    const episode = store.addEpisode(project.id, { title: "migration fixture", cues: [{ id: "1", start: 1.123, end: 2.456, text: "你好", vi: "Xin chào" }] });
    store.close(); store = null;
    const child = spawn(process.execPath, [path.join(projectRoot, "scripts/configure-local.mjs")], {
      cwd: root, env: { ...process.env, VIETSTUDIO_ENV_FILE: "", VIETSTUDIO_DATA: data }, stdio: "ignore",
    });
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(fs.readdirSync(path.join(data, "backups")).filter(f => f.endsWith(".sqlite")).length, 1);
    store = new Store(data);
    assert.equal(store.settings().translationEngine, "opus");
    assert.equal(store.settings().forceCpu, true);
    assert.equal(store.settings().cookies, "private-cookie-path");
    assert.equal(store.settings().whisperModel, "./models/ggml-small.bin");
    assert.deepEqual(store.episode(episode.id).cues, episode.cues);
  } finally { store?.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

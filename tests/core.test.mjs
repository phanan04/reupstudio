import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateUrl,
  localEndpoint,
  parseSubtitles,
  validateCues,
  srt,
  ass,
  options,
  run,
} from "../server/core.mjs";
import { Store, optionDefaults } from "../server/store.mjs";
import { Pipeline } from "../server/pipeline.mjs";
test("Only allowed https sources; reject lookalikes and credentials", () => {
  assert.equal(
    validateUrl("https://www.bilibili.com/video/BV123"),
    "https://www.bilibili.com/video/BV123",
  );
  for (const u of [
    "http://bilibili.com",
    "https://bilibili.com.evil.test",
    "https://localhost",
    "https://user@bilibili.com",
    "file:///tmp/test",
    "https://douyin.com:9999",
  ])
    assert.throws(() => validateUrl(u));
});
test("LLM endpoint must remain local", () => {
  assert.equal(
    localEndpoint("http://127.0.0.1:8081/v1/"),
    "http://127.0.0.1:8081/v1",
  );
  assert.throws(() => localEndpoint("https://example.com"));
  assert.throws(() => localEndpoint("http://user:pass@localhost"));
});
test("SRT and VTT parsing preserves timing and Unicode", () => {
  const cues = parseSubtitles(
    "\uFEFF1\r\n00:00:01,250 --> 00:00:03,000\r\n你好\r\n朋友\r\n",
  );
  assert.equal(cues[0].start, 1.25);
  assert.equal(cues[0].text, "你好\n朋友");
  cues[0].vi = "Xin chào bạn";
  assert.match(srt(cues), /Xin chào bạn/);
  assert.equal(
    parseSubtitles(
      "WEBVTT\n\n00:01.250 --> 00:03.000 align:middle\n<b>你好</b>",
    )[0].text,
    "你好",
  );
});
test("Bilibili subtitle JSON", () => {
  assert.equal(
    parseSubtitles('{"body":[{"from":1,"to":2,"content":"你好"}]}')[0].text,
    "你好",
  );
});
test("Cue validation rejects reversed, unordered, unsafe voice and NaN timing", () => {
  for (const cues of [
    [{ start: 3, end: 1 }],
    [
      { start: 1, end: 2 },
      { start: 0, end: 1 },
    ],
    [{ start: 0, end: 2, voice: "../../a" }],
    [{ start: "oops", end: 3 }],
  ])
    assert.throws(() => validateCues(cues));
});
test("ASS escapes override tags and keeps Vietnamese", () => {
  const result = ass([{ start: 1, end: 2, vi: "Xin {\\pos(1,2)} chào\nbạn" }]);
  assert.ok(!result.includes("{\\pos"));
  assert.ok(result.includes("chào\\Nbạn"));
});
test("Options reject out of frame ROI and untrusted encoder", () => {
  assert.throws(() => options({ roiX: 90, roiW: 20 }, optionDefaults));
  assert.throws(() => options({ encoder: "evil" }, optionDefaults));
  assert.equal(options({ dub: false }, optionDefaults).dub, false);
});
test("No shell interpolation in subprocess; cancellation works", async () => {
  const output = await run(process.execPath, [
    "-e",
    "console.log(process.argv[1])",
    "hello; $(whoami)",
  ]);
  assert.equal(output.trim(), "hello; $(whoami)");
  const c = new AbortController();
  const p = run(process.execPath, ["-e", "setTimeout(()=>{},30000)"], {
    signal: c.signal,
  });
  setTimeout(() => c.abort(), 50);
  await assert.rejects(p, /hủy/);
});
test("Persistence, translation cache and interrupted recovery", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vietstudio-"));
  let db;
  try {
    db = new Store(dir);
    const s = db.listSeries()[0];
    const e = db.addEpisode(s.id, { title: "Tập 1" });
    db.patch(e.id, { status: "running", progress: 50 });
    db.cached("key", { vi: "Xin chào" });
    db.close();
    db = new Store(dir);
    assert.equal(db.episode(e.id).status, "interrupted");
    assert.equal(db.cached("key").vi, "Xin chào");
  } finally {
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("One worker at a time; failure does not block following jobs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vietstudio-queue-"));
  const db = new Store(dir);
  try {
    const s = db.listSeries()[0];
    const a = db.addEpisode(s.id, {}),
      b = db.addEpisode(s.id, {});
    const p = new Pipeline(db, dir);
    let concurrent = 0,
      max = 0,
      count = 0;
    p.process = async ({ id }) => {
      concurrent++;
      max = Math.max(max, concurrent);
      await new Promise((r) => setTimeout(r, 15));
      concurrent--;
      count++;
      if (id === a.id) throw Error("test failure");
      db.patch(id, { status: "completed" });
    };
    p.enqueue(a.id);
    assert.throws(() => p.enqueue(a.id));
    p.enqueue(b.id);
    while (p.active || p.pending.length)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(max, 1);
    assert.equal(count, 2);
    assert.equal(db.episode(a.id).status, "failed");
    assert.equal(db.episode(b.id).status, "completed");
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("Render graphs preserve ratio, no upscale; mix does not normalize away speech", () => {
  const p = new Pipeline(null, ".");
  const f = p.filters(
    { ...optionDefaults, cover: "blur" },
    { width: 640, height: 360, hasAudio: true },
    true,
  );
  assert.match(f.graph, /scale=-2:360/);
  assert.match(f.graph, /normalize=0/);
  assert.match(f.graph, /boxblur/);
  assert.deepEqual(
    p.filters(
      { ...optionDefaults, dub: false },
      { width: 640, height: 360, hasAudio: false },
      false,
    ).audio,
    [],
  );
});

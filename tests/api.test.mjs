import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("API persists edits, streams ranges and rejects stale writes / foreign origins", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "vietstudio-api-"));
  const child = spawn(process.execPath, ["server/main.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "18765", VIETSTUDIO_DATA: data },
    windowsHide: true,
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(Error("Server exit " + code)));
    });
    const base = "http://127.0.0.1:18765";
    const request = (url, data, method = "POST") =>
      fetch(base + url, {
        method,
        headers: { "Content-Type": "application/json", "X-VietStudio": "1" },
        body: JSON.stringify(data),
      });
    let r = await fetch(base + "/api/state");
    const s = (await r.json()).series[0];
    r = await request("/api/series", { title: "测试 Series" });
    assert.equal(r.status, 201);
    r = await fetch(base + "/api/upload?seriesId=" + s.id + "&name=test.mp4", {
      method: "POST",
      headers: { "X-VietStudio": "1" },
      body: Buffer.from("0123456789"),
    });
    const e = await r.json();
    assert.equal(r.status, 201);
    r = await fetch(base + `/media/${e.id}/source`, {
      headers: { Range: "bytes=2-5" },
    });
    assert.equal(r.status, 206);
    assert.equal(await r.text(), "2345");
    r = await request(
      `/api/episodes/${e.id}/cues`,
      {
        revision: 0,
        cues: [{ start: 0, end: 2, text: "你好", vi: "Xin chào" }],
      },
      "PUT",
    );
    assert.equal(r.status, 200);
    r = await request(
      `/api/episodes/${e.id}/cues`,
      { revision: 0, cues: [] },
      "PUT",
    );
    assert.equal(r.status, 409);
    const saved = await (await fetch(base + `/api/episodes/${e.id}`)).json();
    const update = { id: saved.cues[0].id, base: saved.cues[0], value: { ...saved.cues[0], vi: "Bản sửa riêng từng câu" } };
    r = await request(`/api/episodes/${e.id}/cues`, { updates: [update] }, "PATCH");
    assert.equal(r.status, 200);
    const patched = await r.json();
    assert.equal(patched.cues[0].vi, update.value.vi);
    assert.ok(patched.userEditedIds.includes(update.id));
    r = await request(`/api/episodes/${e.id}/cues`, { updates: [update] }, "PATCH");
    assert.equal(r.status, 409);
    r = await request(`/api/episodes/${e.id}/pause`, {});
    assert.equal(r.status, 400);
    r = await fetch(base + "/api/series", {
      method: "POST",
      headers: { Origin: "https://evil.example", "X-VietStudio": "1" },
      body: "{}",
    });
    assert.equal(r.status, 403);
    r = await fetch(base + "/api/series", { method: "POST", body: "{}" });
    assert.equal(r.status, 403);
    r = await request("/api/inspect", { url: "http://127.0.0.1/private" });
    assert.equal(r.status, 400);
    r = await fetch(base + `/media/${e.id}/source`, {
      headers: { Range: "bytes=999-" },
    });
    assert.equal(r.status, 416);
    r = await request("/api/subtitle-project", {
      seriesId: s.id,
      title: "CapCut.srt",
      content:
        "1\n00:00:01,123 --> 00:00:03,456\n姐姐，我相信你。\n\n2\n00:00:05,007 --> 00:00:06,890\n谢谢。\n",
    });
    assert.equal(r.status, 201);
    let subtitle = await r.json();
    assert.equal(subtitle.subtitleOnly, true);
    assert.equal(subtitle.source, undefined);
    assert.equal(
      (await fetch(base + `/media/${subtitle.id}/subtitles`)).status,
      400,
    );
    const values = subtitle.cues.map((c, i) => ({
      ...c,
      vi: i ? "Cảm ơn." : "Chị à, em tin chị.",
      speaker: "em",
      listener: "chi",
    }));
    r = await request(
      `/api/episodes/${subtitle.id}/cues`,
      { revision: subtitle.revision, cues: values },
      "PUT",
    );
    subtitle = await r.json();
    r = await request(`/api/episodes/${subtitle.id}/approve`, {
      revision: subtitle.revision,
      ids: ["1"],
    });
    assert.deepEqual((await r.json()).approvedIds, ["1"]);
    r = await request(`/api/episodes/${subtitle.id}/reset-translation`, {});
    subtitle = await r.json();
    assert.equal(subtitle.cues[0].vi, values[0].vi);
    assert.equal(subtitle.cues[1].vi, "");
    r = await request(
      `/api/episodes/${subtitle.id}/cues`,
      { revision: subtitle.revision, cues: values },
      "PUT",
    );
    subtitle = await r.json();
    const exported = await (
      await fetch(base + `/media/${subtitle.id}/subtitles`)
    ).text();
    assert.match(exported, /00:00:01,123 --> 00:00:03,456/);
    assert.match(exported, /00:00:05,007 --> 00:00:06,890/);
    assert.match(exported, /Chị à, em tin chị/);
    r = await request(`/api/episodes/${subtitle.id}/unapprove`, {
      revision: subtitle.revision,
      ids: ["1"],
    });
    assert.deepEqual((await r.json()).approvedIds, []);
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    await rm(data, { recursive: true, force: true });
  }
});

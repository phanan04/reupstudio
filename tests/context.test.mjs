import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { Store } from "../server/store.mjs";
import { validateCues } from "../server/core.mjs";
import {
  getKnowledge,
  putKnowledge,
  approveCues,
  approvalState,
  reuseMemory,
  retrieve,
  contextFor,
} from "../server/knowledge.mjs";
import {
  translateContext,
  translateBatch,
  reviewTranslation,
  qualityFingerprint,
  ruleIssues,
} from "../server/translation.mjs";
import { chatJSON, remoteEndpoint } from "../server/ai-provider.mjs";
test("Translation splits invalid ID batches, constrains schema, never accepts shifted IDs", async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), data = JSON.parse(body.messages[1].content);
    requests.push(body);
    const rows = data.subtitles.length > 1
      ? [{id: "wrong", vi: "Sai"}]
      : [{id: data.subtitles[0].id, vi: "Bản dịch " + data.subtitles[0].id}];
    res.end(JSON.stringify({message: {content: JSON.stringify({translations: rows})}}));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const data = {subtitles: [{id: "93", zh: "隔壁邻居说"}, {id: "94", zh: "那时我正半梦半息"}]};
    const result = await translateBatch({translationEngine: "ollama", ollamaUrl: `http://127.0.0.1:${server.address().port}`, ollamaModel: "test"}, new AbortController().signal, "Translate", data);
    assert.deepEqual(result.translations.map(x => x.id), ["93", "94"]);
    assert.equal(requests.length, 5);
    assert.deepEqual(requests[0].format.properties.translations.items.properties.id.enum, ["93", "94"]);
    assert.equal(requests[0].format.properties.translations.minItems, 2);
    assert.equal(requests[3].format.properties.translations.maxItems, 1);
  } finally { await new Promise(r => server.close(r)); }
});
async function fixture(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vietstudio-context-")),
    store = new Store(dir);
  try {
    await fn(store, store.listSeries()[0]);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
const cues = () =>
  validateCues([
    {
      start: 1.12,
      end: 3.45,
      text: "姐姐，我相信你。",
      vi: "Chị à, em tin chị.",
      speaker: "em",
      listener: "chi",
      scene: "nói riêng",
    },
    {
      start: 4,
      end: 6.7,
      text: "我不会背叛你。",
      vi: "Em sẽ không phản bội chị.",
      speaker: "em",
      listener: "chi",
      scene: "nói riêng",
    },
  ]);
test("Project trash hides episodes, blocks running work and restores data", () => fixture(async (s,p) => {
  const e = s.addEpisode(p.id, {cues:cues(), status:'running'});
  assert.throws(()=>s.trashSeries(p.id), /Dừng/);
  s.patch(e.id,{status:'idle'});
  s.trashSeries(p.id);
  assert.equal(s.series(p.id), undefined);
  assert.equal(s.episode(e.id), null);
  assert.equal(s.episodes().length, 0);
  assert.ok(s.listSeries().length);
  s.restoreSeries(p.id);
  assert.deepEqual(s.episode(e.id).cues, cues());
}));
const knowledge = () => ({
  synopsis: "Hai chị em bảo vệ nhau.",
  terms: [{ source: "背叛", target: "phản bội", strict: true }],
  characters: [
    { id: "em", zh: "林月", vi: "Lâm Nguyệt" },
    { id: "chi", zh: "林雪", vi: "Lâm Tuyết" },
  ],
  relations: [{ from: "em", to: "chi", self: "em", address: "chị" }],
  notes: [
    {
      title: "Tập 1",
      content: "林月 đã biết người chị 林雪 bị đe dọa.",
      episodeOrder: 1,
    },
    { title: "Tập 8", content: "林月 trở thành hoàng hậu.", episodeOrder: 8 },
  ],
});
test("Approved memory is context-sensitive, isolated by project, invalidated on edits and knowledge changes", () =>
  fixture(async (s, p) => {
    putKnowledge(s, p.id, knowledge(), 0);
    const e = s.addEpisode(p.id, { cues: cues() }),
      next = s.addEpisode(p.id, {
        cues: cues().map((c) => ({ ...c, vi: "" })),
      });
    approveCues(s, e, ["1", "2"]);
    assert.deepEqual(approvalState(s, e), ["1", "2"]);
    assert.equal(reuseMemory(s, next, next.cues)[0].vi, e.cues[0].vi);
    assert.equal(
      reuseMemory(
        s,
        next,
        next.cues.map((c) => ({ ...c, speaker: "chi", listener: "em" })),
      )[0].vi,
      "",
    );
    const other = s.createSeries("khác"),
      foreign = s.addEpisode(other.id, { cues: next.cues });
    assert.equal(reuseMemory(s, foreign, foreign.cues)[0].vi, "");
    s.patch(e.id, {
      cues: e.cues.map((c) => ({ ...c, vi: "Bản sửa chưa duyệt" })),
    });
    assert.equal(approvalState(s, s.episode(e.id)).length, 0);
    assert.equal(reuseMemory(s, next, next.cues)[0].vi, "");
    approveCues(s, s.episode(e.id), ["1", "2"]);
    const k = getKnowledge(s, p.id);
    putKnowledge(s, p.id, { ...k, synopsis: "Đổi quan hệ" }, k.version);
    assert.equal(reuseMemory(s, next, next.cues)[0].vi, "");
  }));
test("RAG retrieves Chinese lexical evidence, excludes future episodes and unapproved translations", () =>
  fixture(async (s, p) => {
    putKnowledge(s, p.id, knowledge(), 0);
    s.addEpisode(p.id, { cues: cues() });
    const e = s.addEpisode(p.id, { cues: cues() });
    const evidence = retrieve(s, e, [
      { text: "林月和林雪", speaker: "em", listener: "chi" },
    ]);
    assert.ok(evidence.some((x) => x.text.includes("đe dọa")));
    assert.ok(!evidence.some((x) => x.text.includes("hoàng hậu")));
    assert.ok(!evidence.some((x) => x.source.startsWith("approved:")));
    assert.equal(contextFor(s, e, e.cues).relations[0].self, "em");
  }));
test("Rules flag missing, terminology and pronoun risks without changing timestamps", () => {
  const source = cues();
  const before = structuredClone(source);
  source[0].vi = "Tôi tin anh";
  source[1].vi = "";
  const issues = ruleIssues(source, knowledge());
  assert.ok(issues.some((x) => x.type === "pronoun"));
  assert.ok(issues.some((x) => x.type === "missing"));
  assert.deepEqual(
    source.map((c) => [c.start, c.end]),
    before.map((c) => [c.start, c.end]),
  );
});
test("Context translation resumes checkpoints, preserves speaker/timestamps and validates all IDs", () =>
  fixture(async (s, p) => {
    putKnowledge(s, p.id, knowledge(), 0);
    const original = cues().map((c) => ({ ...c, vi: "" })),
      e = s.addEpisode(p.id, { cues: original });
    let fail = true,
      calls = 0,
      payloads = [];
    const server = http.createServer(async (req, res) => {
      let b = "";
      for await (const c of req) b += c;
      const data = JSON.parse(JSON.parse(b).messages[1].content);
      payloads.push(data);
      calls++;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: data.subtitles
                    .filter((q) => !(fail && q.id === "2"))
                    .map((q) => ({ id: q.id, vi: "Em tin chị." })),
                }),
              },
            },
          ],
        }),
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const c = {
          ...s.settings(),
          batchSize: 1,
          autoReview: false,
          managedLlm: false,
          llmUrl: `http://127.0.0.1:${server.address().port}/v1`,
        },
        signal = new AbortController().signal;
      await assert.rejects(
        translateContext(s, original, p.options, c, signal, () => {}, e.id),
        /thiếu câu/,
      );
      assert.equal(s.episode(e.id).cues[0].vi, "Em tin chị.");
      assert.equal(s.episode(e.id).cues[1].vi, "");
      fail = false;
      const count = calls;
      const result = await translateContext(
        s,
        s.episode(e.id).cues,
        p.options,
        c,
        signal,
        () => {},
        e.id,
      );
      assert.equal(calls, count + 1);
      assert.deepEqual(
        result.map((q) => [q.start, q.end, q.speaker, q.listener]),
        original.map((q) => [q.start, q.end, q.speaker, q.listener]),
      );
      assert.equal(payloads[0].knowledge.relations[0].self, "em");
    } finally {
      await new Promise((r) => server.close(r));
    }
  }));
test("AI review caches completed batches, rejects missing IDs, keeps suggestions separate, becomes stale after edits", () =>
  fixture(async (s, p) => {
    const e = s.addEpisode(p.id, { cues: cues() });
    let calls = 0;
    const server = http.createServer(async (req, res) => {
      let b = "";
      for await (const c of req) b += c;
      const data = JSON.parse(JSON.parse(b).messages[1].content);
      calls++;
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  checks: data.subtitles.map((q) => ({
                    id: q.id,
                    verdict: "error",
                    type: "meaning",
                    message: "Sai nghĩa cần sửa",
                    suggestion: "Bản gợi ý",
                  })),
                }),
              },
            },
          ],
        }),
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const c = {
        ...s.settings(),
        llmUrl: `http://127.0.0.1:${server.address().port}/v1`,
      };
      const signal = new AbortController().signal;
      const q = await reviewTranslation(s, e.id, c, signal);
      assert.equal(q.status, "complete");
      assert.equal(q.reviewed, 2);
      assert.deepEqual(s.episode(e.id).cues, e.cues);
      await reviewTranslation(s, e.id, c, signal);
      assert.equal(calls, 1);
      s.patch(e.id, { cues: e.cues.map((x) => ({ ...x, vi: "Đã sửa" })) });
      assert.notEqual(qualityFingerprint(s, s.episode(e.id)), q.fingerprint);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }));
test("Ollama uses native JSON, force CPU on GPU error, no remote transmission without opt-in", async () => {
  let requests = [];
  const server = http.createServer(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    requests.push(JSON.parse(b));
    if (requests.length === 1) {
      res.writeHead(500);
      res.end("{}");
    } else res.end(JSON.stringify({ message: { content: '{"ok":true}' } }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await chatJSON(
      {
        translationEngine: "ollama",
        ollamaUrl: `http://127.0.0.1:${server.address().port}`,
        ollamaModel: "qwen",
        threads: 4,
        cpuFallback: true,
      },
      new AbortController().signal,
      "system",
      {},
      () => {},
    );
    assert.equal(requests[1].options.num_gpu, 0);
    assert.equal(requests[1].think, false);
    await assert.rejects(
      chatJSON(
        {
          translationEngine: "api",
          apiUrl: "https://example.com/v1",
          allowRemote: false,
        },
        new AbortController().signal,
        "system",
        {},
        () => {},
      ),
      /Chưa bật/,
    );
    assert.throws(() => remoteEndpoint("http://example.com/v1"), /HTTPS/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

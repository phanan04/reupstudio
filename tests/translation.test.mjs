import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pipeline } from "../server/pipeline.mjs";
import { Store } from "../server/store.mjs";
import { blockedReason, withLlm } from "../server/llm.mjs";
test("LLM retries malformed JSON, enforces IDs, receives context and reuses cache", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vietstudio-llm-")),
    db = new Store(dir);
  let calls = 0,
    requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const b = JSON.parse(body),
      data = JSON.parse(b.messages[1].content);
    requests.push(data);
    calls++;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                calls === 1
                  ? "bad json"
                  : JSON.stringify({
                      translations: data.subtitles.map((s) => ({
                        id: s.id,
                        vi: "Xin chào " + s.id,
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
    const s = db.listSeries()[0],
      e = db.addEpisode(s.id, {}),
      p = new Pipeline(db, dir);
    const c = {
      ...db.settings(),
      llmUrl: `http://127.0.0.1:${server.address().port}/v1`,
      batchSize: 2,
    };
    const cues = [0, 1, 2].map((n) => ({
      id: String(n + 1),
      start: n * 3,
      end: n * 3 + 2,
      text: "你好" + n,
      vi: "",
    }));
    const o = {
      ...s.options,
      context: "Hai người bạn",
      glossary: "师父 = sư phụ",
    };
    const result = await p.translate(
      cues,
      o,
      c,
      new AbortController().signal,
      () => {},
      e.id,
    );
    assert.equal(result.length, 3);
    assert.equal(calls, 3);
    assert.equal(requests[0].glossary, o.glossary);
    assert.equal(requests[2].previous.length, 2);
    assert.equal(requests[2].previous[0].vi, "Xin chào 1");
    await p.translate(cues, o, c, new AbortController().signal, () => {}, e.id);
    assert.equal(calls, 3);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("Confirmed blocked runtime is never launched again", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vietstudio-block-"));
  try {
    const binary = path.join(dir, "llama.exe"),
      dll = path.join(dir, "ggml.dll"),
      model = path.join(dir, "model.gguf");
    await writeFile(binary, "not executable");
    await writeFile(dll, "blocked");
    await writeFile(model, "model");
    await writeFile(
      binary + ".blocked.json",
      JSON.stringify({
        library: "ggml.dll",
        sha256: createHash("sha256").update("blocked").digest("hex"),
        reason: "Windows blocked test runtime",
      }),
    );
    assert.equal(blockedReason(binary), "Windows blocked test runtime");
    await assert.rejects(
      withLlm(
        { managedLlm: true, llama: binary, llamaModel: model },
        new AbortController().signal,
        () => {
          throw Error("must not run");
        },
      ),
      /Windows blocked/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

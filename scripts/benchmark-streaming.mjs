// Scheduler benchmark only: simulated ASR/LLM latency, not model/GPU throughput.
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { boundedPipeline } from "../server/streaming.mjs";
const count = 12, asrMs = 40, translationMs = 60;
async function measure(kind) {
  const start = performance.now(); let first = null, completed = 0;
  const consume = async () => { await delay(translationMs); completed++; first ??= performance.now() - start; };
  if (kind === "whole-video") {
    for (let i = 0; i < count; i++) await delay(asrMs);
    for (let i = 0; i < count; i++) await consume();
  } else {
    await boundedPipeline(async function* () { for (let i = 0; i < count; i++) { await delay(asrMs); yield i; } }, consume,
      { parallel: () => kind === "overlap" });
  }
  return { mode: kind, firstTranslationMs: Math.round(first), totalMs: Math.round(performance.now() - start), completed };
}
const results = [];
for (const mode of ["whole-video", "serial-chunks", "overlap"]) results.push(await measure(mode));
console.log(JSON.stringify({ kind: "simulated-scheduler-only", count, asrMs, translationMs, results }, null, 2));

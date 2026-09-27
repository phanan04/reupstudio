import { setTimeout as delay } from "node:timers/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { run, localEndpoint } from "./core.mjs";
export async function withLlm(c, signal, fn, log = () => {}) {
  if (!c.managedLlm) return fn();
  if (
    !c.llama ||
    !existsSync(c.llama) ||
    !c.llamaModel ||
    !existsSync(c.llamaModel)
  )
    throw Error(
      "Chưa cài llama-server hoặc mô hình dịch GGUF. Mở Cấu hình máy.",
    );
  const block = blockedReason(c.llama);
  if (block) throw Error(block);
  const endpoint = localEndpoint(c.llmUrl),
    url = new URL(endpoint);
  let occupied = false;
  try {
    await fetch(endpoint + "/models", { signal: AbortSignal.timeout(1000) });
    occupied = true;
  } catch {}
  if (occupied)
    throw Error(
      "Cổng AI đang có máy chủ khác. Tắt máy chủ đó hoặc bỏ “Tự quản lý mô hình dịch”.",
    );
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  let failure = null;
  log(
    "Nạp mô hình dịch; mô hình sẽ được đóng sau bước dịch để giải phóng VRAM.",
  );
  const process = run(
    c.llama,
    [
      "-m",
      c.llamaModel,
      "--host",
      "127.0.0.1",
      "--port",
      url.port || "8081",
      "-c",
      String(c.contextSize || 4096),
      "-ngl",
      c.forceCpu ? 0 : c.gpuLayers,
      "-t",
      c.threads,
      "--parallel",
      "1",
      "--alias",
      c.llmModel,
      "--jinja",
    ],
    { signal: controller.signal, timeout: 24 * 3600000 },
  ).catch((e) => {
    failure = e;
  });
  try {
    let ready = false;
    for (let i = 0; i < 240; i++) {
      if (signal.aborted) throw Error("Đã hủy");
      if (failure) throw failure;
      try {
        const r = await fetch(endpoint + "/models", {
          signal: AbortSignal.timeout(1000),
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(500, undefined, { signal });
    }
    if (!ready) throw Error("Mô hình dịch không khởi động trong 2 phút");
    return await fn();
  } finally {
    controller.abort();
    await process;
    signal.removeEventListener("abort", stop);
    log("Đã đóng mô hình dịch.");
  }
}
export function blockedReason(binary) {
  const marker = binary + ".blocked.json";
  if (!existsSync(marker)) return "";
  try {
    const b = JSON.parse(readFileSync(marker, "utf8"));
    const dll = path.join(path.dirname(binary), b.library);
    if (
      existsSync(dll) &&
      createHash("sha256").update(readFileSync(dll)).digest("hex") === b.sha256
    )
      return b.reason;
  } catch {
    return "Không xác minh được trạng thái công cụ. Kiểm tra lại cấu hình.";
  }
  return "";
}

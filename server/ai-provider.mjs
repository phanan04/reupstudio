import { localEndpoint } from "./core.mjs";
import { withLlm } from "./llm.mjs";

export function remoteEndpoint(value) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw Error("API từ xa phải là HTTPS, không chứa khóa trong URL");
  return u.href.replace(/\/$/, "");
}
export const providerIdentity = (c) => ({
  engine: c.translationEngine,
  url:
    c.translationEngine === "ollama"
      ? c.ollamaUrl
      : c.translationEngine === "api"
        ? c.apiUrl
        : c.llmUrl,
  model:
    c.translationEngine === "ollama"
      ? c.ollamaModel
      : c.translationEngine === "api"
        ? c.apiModel
        : c.llmModel,
  context: c.contextSize,
  prompt: 2,
});
export async function withProvider(c, signal, fn, log = () => {}) {
  if (c.translationEngine === "llm") return withLlm(c, signal, fn, log);
  try {
    return await fn();
  } finally {
    if (c.translationEngine === "ollama") {
      try {
        await fetch(localEndpoint(c.ollamaUrl) + "/api/generate", {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: c.ollamaModel, keep_alive: 0 }),
          signal: AbortSignal.timeout(10000),
        });
        log("Đã yêu cầu Ollama nhả mô hình sau bước dịch/kiểm tra.");
      } catch {
        log("Ollama sẽ tự nhả mô hình khi hết keep_alive.");
      }
    }
  }
}
export function boundedContext(data, system, contextSize = 4096) {
  const copy = structuredClone(data);
  const estimate = (value) => {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return Math.ceil(
      (s.match(/[\x00-\x7F]/g)?.length || 0) / 3 +
        (s.match(/[^\x00-\x7F]/g)?.length || 0) * 1.5,
    );
  };
  const budget =
    contextSize -
    Math.min(2048, Math.floor(contextSize / 3)) -
    estimate(system) -
    300;
  const fits = () => estimate(copy) <= budget;
  while (!fits() && copy.knowledge?.evidence?.length)
    copy.knowledge.evidence.pop();
  while (!fits() && copy.previous?.length) copy.previous.shift();
  while (!fits() && copy.following?.length) copy.following.pop();
  if (!fits() && copy.knowledge) {
    copy.knowledge.synopsis = copy.knowledge.synopsis.slice(0, 800);
    for (const ch of copy.knowledge.characters || [])
      ch.description = ch.description?.slice(0, 200);
  }
  if (!fits())
    throw Error(
      "Ngữ cảnh vượt giới hạn an toàn. Giảm số câu mỗi lượt hoặc tăng context trong Cấu hình máy; không cắt nội dung phụ đề.",
    );
  return copy;
}
export async function chatJSON(c, signal, system, data, validate, schema) {
  if (c.translationEngine === "opus")
    throw Error(
      "OPUS không hỗ trợ kiểm tra ngữ nghĩa bằng AI. Chọn Ollama/Qwen, LLM hoặc API.",
    );
  const ollama = c.translationEngine === "ollama",
    remote = c.translationEngine === "api";
  const base = ollama
    ? localEndpoint(c.ollamaUrl)
    : remote
      ? remoteEndpoint(c.apiUrl)
      : localEndpoint(c.llmUrl);
  if (remote && !c.allowRemote)
    throw Error(
      "Chưa bật gửi phụ đề và ngữ cảnh đến API đã chọn trong Cấu hình máy.",
    );
  const key = remote ? process.env[c.apiKeyEnv] : "";
  if (remote && !key)
    throw Error("Chưa đặt biến môi trường khóa API: " + c.apiKeyEnv);
  const contextSize = c.contextSize || 4096;
  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: JSON.stringify(boundedContext(data, system, contextSize)),
    },
  ];
  let last,
    cpu = c.forceCpu === true;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw Error("Đã hủy");
    try {
      const body = ollama
        ? {
            model: c.ollamaModel,
            messages,
            stream: false,
            think: false,
            format: schema || "json",
            keep_alive: "5m",
            options: {
              temperature: 0.15,
              num_ctx: c.contextSize || 4096,
              num_predict: Math.min(2048, Math.floor(contextSize / 3)),
              num_thread: c.threads,
              ...(cpu ? { num_gpu: 0 } : {}),
            },
          }
        : {
            model: remote ? c.apiModel : c.llmModel,
            messages,
            temperature: 0.15,
            max_tokens: 2048,
            response_format: { type: "json_object" },
            ...(!remote
              ? { chat_template_kwargs: { enable_thinking: false } }
              : {}),
          };
      const r = await fetch(
        base + (ollama ? "/api/chat" : "/chat/completions"),
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(c.aiTimeoutMs || 600000),
          ]),
        },
      );
      if (!r.ok) {
        // Never expose remote response bodies: providers may echo credentials or private content.
        if (
          ollama &&
          c.cpuFallback &&
          !cpu &&
          [500, 503, 507].includes(r.status)
        ) {
          cpu = true;
          continue;
        }
        throw Error("Máy chủ AI trả HTTP " + r.status);
      }
      const payload = await r.json(),
        answer = ollama
          ? payload.message?.content
          : payload.choices?.[0]?.message?.content;
      if (typeof answer !== "string" || answer.length > 150000)
        throw Error("AI không trả nội dung hợp lệ");
      const result = JSON.parse(
        answer
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .replace(/^```(?:json)?\s*|\s*```$/g, "")
          .trim(),
      );
      try { validate(result); } catch (err) {
        err.code = "AI_INVALID_OUTPUT";
        throw err;
      }
      return result;
    } catch (err) {
      last = err;
      if (signal.aborted) throw Error("Đã hủy");
      if (messages.length === 2) messages.push({role:'user',content:'Kết quả trước không đúng định dạng/ID. Trả lại JSON đúng schema, đủ mọi ID, không thêm chú thích. ' + err.message});
    }
  }
  const failure = Error("AI thất bại sau 3 lần; checkpoint đã giữ lại. " + last.message);
  failure.code = last.code || (last instanceof SyntaxError ? "AI_INVALID_OUTPUT" : undefined);
  throw failure;
}

export async function providerHealth(c) {
  if (c.translationEngine === "api")
    return {
      name: "API AI",
      ok: !!(c.allowRemote && process.env[c.apiKeyEnv]),
      detail: c.allowRemote
        ? "Cấu hình API; chưa gửi dữ liệu để kiểm tra suy luận."
        : "Chưa cho phép gửi dữ liệu ra API.",
    };
  const ollama = c.translationEngine === "ollama";
  const base = localEndpoint(ollama ? c.ollamaUrl : c.llmUrl);
  const r = await fetch(base + (ollama ? "/api/tags" : "/models"), {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!r.ok) throw Error("Máy chủ AI trả HTTP " + r.status);
  const j = await r.json(),
    model = ollama ? c.ollamaModel : c.llmModel;
  const names = (ollama ? j.models : j.data)?.map((x) => x.name || x.id) || [];
  return {
    name: ollama ? "Ollama / Qwen" : "LLM",
    ok: names.includes(model),
    detail: names.includes(model)
      ? `Có mô hình ${model}. Chưa chứng nhận chất lượng bản dịch.`
      : `Chưa có ${model}. Mô hình đang có: ${names.join(", ")}`,
  };
}

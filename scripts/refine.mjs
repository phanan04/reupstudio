import fs from "node:fs";
let p = "server/main.mjs",
  s = fs.readFileSync(p, "utf8");
s = s
  .replace(
    "'cookies','llmModel']",
    "'cookies','llmModel','llama','llamaModel']",
  )
  .replace("['maxSpeed',1,2]", "['maxSpeed',1,2],['gpuLayers',0,99]")
  .replace(
    "c.ocrDirectML=Boolean(c.ocrDirectML);",
    "c.ocrDirectML=Boolean(c.ocrDirectML);c.managedLlm=Boolean(c.managedLlm);",
  );
fs.writeFileSync(p, s);
p = "server/pipeline.mjs";
s = fs
  .readFileSync(p, "utf8")
  .replace(
    "texts:missing.map(q=>q.text)",
    "texts:missing.map(q=>({id:q.id,text:q.text}))",
  )
  .replace(
    "model:c.llmModel,temperature:.2",
    "model:c.llmModel,chat_template_kwargs:{enable_thinking:false},temperature:.2",
  );
fs.writeFileSync(p, s);
p = "public/app.js";
s = fs
  .readFileSync(p, "utf8")
  .replace(
    "llmModel:'Tên mô hình dịch',",
    "llmModel:'Tên mô hình dịch',llama:'llama-server · Vulkan build',llamaModel:'Mô hình dịch (.gguf)',gpuLayers:'Số lớp đưa lên GPU (0 = CPU)',",
  )
  .replace(
    "['threads','batchSize','maxSpeed'].includes(key)",
    "['threads','batchSize','maxSpeed','gpuLayers'].includes(key)",
  )
  .replace(
    '<label class="check-label wide"><input name="ocrDirectML"',
    '<label class="check-label wide"><input name="managedLlm" type="checkbox" ${c.managedLlm?\'checked\':\'\'}> Tự quản lý mô hình dịch · Nạp khi cần, đóng sau khi dịch</label><label class="check-label wide"><input name="ocrDirectML"',
  );
fs.writeFileSync(p, s);

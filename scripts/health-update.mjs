import fs from "node:fs";
const p = "server/main.mjs";
let s = fs.readFileSync(p, "utf8");
s = s.replace(
  "import {Pipeline} from './pipeline.mjs';",
  "import {Pipeline} from './pipeline.mjs';\nimport {blockedReason} from './llm.mjs';",
);
s = s.replace(
  "try{const r=await fetch(localEndpoint(c.llmUrl)+'/models'",
  "if(c.managedLlm){const reason=c.llama?blockedReason(c.llama):'';result.push({name:'AI dịch local',ok:!reason&&!!c.llama&&existsSync(c.llama)&&!!c.llamaModel&&existsSync(c.llamaModel),detail:reason||'Tự nạp khi dịch; kiểm tra sự hiện diện của tệp, chưa chứng nhận suy luận.'});}else try{const r=await fetch(localEndpoint(c.llmUrl)+'/models'",
);
fs.writeFileSync(p, s);

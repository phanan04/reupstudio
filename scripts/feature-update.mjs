import fs from "node:fs";
function edit(p, fn) {
  fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
}
edit("server/store.mjs", (s) =>
  s.replace(
    "llmModel:'local',",
    "llmModel:'local',translationEngine:'llm',opusModel:'',",
  ),
);
edit("server/pipeline.mjs", (s) =>
  s
    .replace(
      "import {withLlm} from './llm.mjs';",
      "import {withLlm} from './llm.mjs';\nimport {translateOpus} from './opus.mjs';",
    )
    .replace(
      "'-filter_complex_script','render-filter.txt'",
      "'-filter_complex',filter.graph",
    )
    .replace(
      "if(cues.some(q=>!q.vi))cues=await withLlm",
      "if(cues.some(q=>!q.vi)&&c.translationEngine==='opus')cues=await translateOpus(cues,c,{root:this.root,dir,signal,store,id});else if(cues.some(q=>!q.vi))cues=await withLlm",
    ),
);
edit("server/main.mjs", (s) =>
  s
    .replace("'llama','llamaModel']", "'llama','llamaModel','opusModel']")
    .replace(
      "c.llmUrl=localEndpoint(c.llmUrl);",
      "if(!['llm','opus'].includes(c.translationEngine))throw Error('Bộ dịch không hợp lệ');c.llmUrl=localEndpoint(c.llmUrl);",
    )
    .replace(
      "if(c.managedLlm){const reason=",
      "if(c.translationEngine==='opus'){result.push({name:'AI dịch CPU · OPUS',ok:!!c.opusModel&&existsSync(path.join(c.opusModel,'pytorch_model.bin')),detail:'Dịch từng câu, cần duyệt. Không dùng ngữ cảnh/thuật ngữ của LLM.'});}else if(c.managedLlm){const reason=",
    ),
);
edit("public/app.js", (s) =>
  s
    .replace(
      "llmModel:'Tên mô hình dịch',",
      "opusModel:'Thư mục mô hình OPUS CPU',llmModel:'Tên mô hình dịch',",
    )
    .replace(
      "$('#settingsForm').innerHTML=Object.entries",
      "$('#settingsForm').innerHTML=`<label class=\"wide\">Bộ dịch<select name=\"translationEngine\"><option value=\"llm\" ${c.translationEngine==='llm'?'selected':''}>LLM · Ngữ cảnh và thuật ngữ</option><option value=\"opus\" ${c.translationEngine==='opus'?'selected':''}>OPUS · Dịch nhanh trên CPU, cần duyệt</option></select></label>`+Object.entries",
    ),
);
edit("scripts/configure-local.mjs", (s) =>
  s.replace(
    "llmModel:'qwen3-4b',",
    "llmModel:'qwen3-4b',opusModel:path.join(root,'models/opus-zh-vi'),",
  ),
);
edit("public/index.html", (s) =>
  s
    .replace(
      '<button id="runSeries" class="button primary full">▶ Xử lý cả series</button>',
      '<button id="runSeries" class="button primary full">▶ Xử lý cả series</button><button id="renderSeries" class="button full">Xuất các tập chờ duyệt</button><button id="cancelSeries" class="button subtle full">Dừng cả series</button>',
    )
    .replace(
      '<button id="addCue"',
      '<button id="resetTranslation" class="button small">Dịch lại</button><button id="addCue"',
    )
    .replace(
      "Windows · AMD Vulkan ready architecture",
      "Windows · Local processing",
    ),
);
edit(
  "public/app.js",
  (s) =>
    s +
    `\n$('#renderSeries').onclick=action(()=>queue(state.episodes.filter(e=>e.seriesId===seriesId&&e.status==='review').map(e=>e.id),'render'));\n$('#cancelSeries').onclick=action(async()=>{for(const e of state.episodes.filter(e=>e.seriesId===seriesId&&['queued','running'].includes(e.status)))await api('/api/episodes/'+e.id+'/cancel',{});await refresh();});\n$('#resetTranslation').onclick=action(async()=>{if(!selectedId)throw Error('Chọn tập trước');if(!confirm('Xóa bản dịch hiện tại để dịch lại? Phụ đề Trung được giữ.'))return;selected=await api('/api/episodes/'+selectedId+'/reset-translation',{});cues=selected.cues;revision=selected.revision;dirty=false;renderCues();toast('Đã xóa bản dịch. Chọn xử lý tập để dịch lại.');});\n`,
);

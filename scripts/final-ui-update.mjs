import fs from "node:fs";
function edit(p, fn) {
  fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8")));
}
edit("public/index.html", (s) =>
  s
    .replace(
      '<div class="workspace">',
      '<div id="runtimeNotice" class="runtime-note" hidden></div><div class="workspace">',
    )
    .replace(
      '<div id="subtitleOverlay"></div>',
      '<div id="subtitleOverlay"></div><div id="roiOutline" class="roi-outline"></div>',
    ),
);
edit("server/main.mjs", (s) =>
  s.replace(
    "return {series:store.listSeries(),episodes:",
    "return {translationEngine:store.settings().translationEngine,series:store.listSeries(),episodes:",
  ),
);
edit(
  "public/app.js",
  (s) =>
    s
      .replace(
        "state=await api('/api/state');",
        "state=await api('/api/state');$('#runtimeNotice').hidden=state.translationEngine!=='opus';$('#runtimeNotice').textContent='Đang dùng OPUS CPU · Dịch từng câu. Ngữ cảnh và bảng thuật ngữ chỉ áp dụng với bộ dịch LLM. Hãy duyệt bản dịch trước khi xuất.';",
      )
      .replace(
        "$('#selectedStatus').textContent=statusNames[selected.status]||selected.status;",
        "$('#selectedStatus').textContent=(statusNames[selected.status]||selected.status)+(selected.output&&selected.outputRevision!==selected.revision?' · Bản xuất chưa cập nhật':'');",
      )
      .replace(
        "$('#subtitleOverlay').textContent='';}",
        "$('#subtitleOverlay').textContent='';updateROI();}",
      ) +
    `\nfunction updateROI(){const f=$('#optionsForm').elements;const roi=$('#roiOutline');roi.style.display=selected?.source&&!output&&(f.cover.value!=='none'||f.subtitleMode.value==='ocr')?'block':'none';roi.style.left=f.roiX.value+'%';roi.style.top=f.roiY.value+'%';roi.style.width=f.roiW.value+'%';roi.style.height=f.roiH.value+'%';}\nfor(const key of ['roiX','roiY','roiW','roiH','cover','subtitleMode'])$('#optionsForm').elements[key].addEventListener('input',updateROI);\n`,
);
edit("server/store.mjs", (s) =>
  s.replace(
    "['running','queued'].includes(e.status)",
    "['running','queued','uploading'].includes(e.status)",
  ),
);

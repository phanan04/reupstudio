const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const statusText = {
  idle: "Sẵn sàng",
  queued: "Đang chờ",
  running: "Đang xử lý",
  review: "Phụ đề sẵn sàng",
  completed: "Đã xuất",
  failed: "Có lỗi",
  cancelled: "Đã dừng",
  interrupted: "Có thể tiếp tục",
  uploading: "Đang tải lên",
};
let state = { series: [], episodes: [] },
  projectKnowledge = null,
  subtitleTime = 0,
  projectId = localStorage.getItem("projectId"),
  selected = null,
  cues = [],
  cueIndex = -1,
  revision = 0,
  editVersion = 0,
  dirty = false,
  options = {},
  optionsDirty = false,
  saving = null,
  optionSaving = null,
  saveTimer,
  optionTimer,
  toastTimer,
  outputPreview = false,
  currentTool = "media",
  inspectorTab = "captions",
  listSignature = "",
  polling = false,
  uploading = false,
  exportingId = null,
  captionLimit = 200,
  dragging = false;
const optionMap = {
  subtitleMode: "subtitleMode",
  style: "translationStyle",
  context: "context",
  glossary: "glossary",
  dub: "dub",
  voice: "voice",
  originalVolume: "originalVolume",
  cover: "cover",
  roiX: "roiX",
  roiY: "roiY",
  roiW: "roiW",
  roiH: "roiH",
  burn: "burn",
  outputHeight: "outputHeight",
  encoder: "encoder",
};
async function api(url, data, method) {
  const r = await fetch(url, {
    method: method || (data ? "POST" : "GET"),
    headers: data
      ? { "Content-Type": "application/json", "X-VietStudio": "1" }
      : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Không kết nối được máy chủ");
  return j;
}
function notify(text) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 6000);
}
function action(fn) {
  return async (e) => {
    try {
      await fn(e);
    } catch (err) {
      notify(err.message);
    }
  };
}
function busy() {
  return (
    selected && ["queued", "running", "uploading"].includes(selected.status)
  );
}
function setSaved(message, error = false) {
  $("#saveStatus").textContent = message;
  $("#saveStatus").classList.toggle("error", error);
}
function time(t) {
  t = Number.isFinite(t) ? Math.max(0, t) : 0;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
}
function duration() {
  return Number.isFinite($("#player").duration)
    ? $("#player").duration
    : selected?.media?.duration || Math.max(10, ...cues.map((c) => c.end));
}
function project() {
  return state.series.find((s) => s.id === projectId);
}
function showTool(name) {
  currentTool = name;
  $$("[data-tool]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === name),
  );
  if (name === "voice") {
    showInspector("voice");
    return;
  }
  $("#mediaLibrary").hidden = name !== "media";
  $("#captionLibrary").hidden = name !== "captions";
  $("#libraryTitle").textContent =
    name === "media" ? "Video của tôi" : "Danh sách phụ đề";
  $("#itemCount").textContent =
    name === "media"
      ? state.episodes.filter((e) => e.seriesId === projectId).length
      : cues.length;
  if (name === "captions") {
    showInspector("captions", false);
    renderCaptionList();
  }
  if (matchMedia("(max-width:650px)").matches)
    $("#mediaLibrary").closest(".library-panel").classList.toggle("open");
}
function showInspector(name, open = true) {
  inspectorTab = name;
  for (const tab of ["captions", "voice", "video"])
    $("#" + tab + "Properties").hidden = tab !== name;
  $$("[data-inspector]").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.inspector === name)),
  );
  if (open && matchMedia("(max-width:950px)").matches)
    $("#inspector").classList.add("open");
}
$$("[data-tool]").forEach((b) => (b.onclick = () => showTool(b.dataset.tool)));
$$("[data-inspector]").forEach(
  (b) => (b.onclick = () => showInspector(b.dataset.inspector)),
);
$("#inspectorToggle").onclick = () => $("#inspector").classList.toggle("open");
$$("[data-close]").forEach(
  (b) => (b.onclick = () => $("#" + b.dataset.close).close()),
);
$("#preview").addEventListener("click", () => {
  if (matchMedia("(max-width:950px)").matches)
    $("#inspector").classList.remove("open");
  if (matchMedia("(max-width:650px)").matches)
    $(".library-panel").classList.remove("open");
});
function applyOptions() {
  for (const [key, id] of Object.entries(optionMap)) {
    const el = $("#" + id),
      value = options[key];
    if (value === undefined) continue;
    if (el.type === "checkbox") el.checked = value;
    else el.value = value;
  }
  $("#volumeLabel").textContent =
    Math.round((options.originalVolume ?? 0.12) * 100) + "%";
  $("#roiControls").hidden =
    options.cover === "none" && options.subtitleMode !== "ocr";
  updateOverlay();
}
function changedOptions() {
  for (const [key, id] of Object.entries(optionMap)) {
    const el = $("#" + id);
    options[key] =
      el.type === "checkbox"
        ? el.checked
        : ["range", "number"].includes(el.type)
          ? Number(el.value)
          : el.value;
  }
  optionsDirty = true;
  $("#volumeLabel").textContent =
    Math.round(options.originalVolume * 100) + "%";
  $("#roiControls").hidden =
    options.cover === "none" && options.subtitleMode !== "ocr";
  setSaved("Đang lưu…");
  updateOverlay();
  renderTimeline();
  clearTimeout(optionTimer);
  optionTimer = setTimeout(
    () =>
      saveOptions().catch((e) => {
        setSaved("Chưa lưu", true);
        notify(e.message);
      }),
    700,
  );
}
for (const id of Object.values(optionMap))
  $("#" + id).addEventListener(
    ["context", "glossary"].includes(id) ? "input" : "change",
    changedOptions,
  );
$("#originalVolume").addEventListener(
  "input",
  () =>
    ($("#volumeLabel").textContent =
      Math.round(Number($("#originalVolume").value) * 100) + "%"),
);
async function saveOptions() {
  if (optionSaving) {
    await optionSaving;
    if (optionsDirty) return saveOptions();
    return;
  }
  if (!optionsDirty) return;
  clearTimeout(optionTimer);
  const target = projectId,
    snapshot = JSON.stringify(options);
  optionSaving = api(
    "/api/series/" + target,
    { options: JSON.parse(snapshot) },
    "PUT",
  );
  try {
    await optionSaving;
    if (projectId === target && JSON.stringify(options) === snapshot)
      optionsDirty = false;
    setSaved(dirty || optionsDirty ? "Chưa lưu" : "Đã lưu");
  } finally {
    optionSaving = null;
  }
}
function markDirty() {
  dirty = true;
  editVersion++;
  setSaved("Đang lưu…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      saveCues().catch((e) => {
        setSaved("Chưa lưu", true);
        notify(e.message);
      }),
    900,
  );
  $("#saveCues").disabled = false;
}
async function saveCues() {
  if (saving) {
    await saving;
    if (dirty) return saveCues();
    return;
  }
  if (!dirty || !selected) return;
  clearTimeout(saveTimer);
  const id = selected.id,
    version = editVersion;
  saving = api(
    "/api/episodes/" + id + "/cues",
    { cues: structuredClone(cues), revision },
    "PUT",
  );
  try {
    const e = await saving;
    if (selected?.id === id) {
      revision = e.revision;
      selected = e;
      if (editVersion === version) {
        dirty = false;
        cues = e.cues;
      }
      setSaved(dirty ? "Đang lưu…" : "Đã lưu");
      renderControls();
    }
  } finally {
    saving = null;
  }
}
async function flush() {
  await saveOptions();
  await saveCues();
}
function renderMedia() {
  const episodes = state.episodes.filter((e) => e.seriesId === projectId);
  const signature = JSON.stringify([
    episodes.map((e) => [e.id, e.title, e.status, e.progress]),
    selected?.id,
  ]);
  if (signature === listSignature) return;
  listSignature = signature;
  $("#episodeList").innerHTML = episodes.length
    ? episodes
        .map(
          (e, i) =>
            `<button class="media-item ${e.id === selected?.id ? "selected" : ""}" data-id="${e.id}" title="${esc(e.title)}"><span class="media-thumb">▷</span><span><strong>${esc(e.title)}</strong><small class="${e.status === "failed" ? "bad" : ""}">${statusText[e.status] || e.status}${e.status === "running" ? " · " + e.progress + "%" : ""}</small></span></button>`,
        )
        .join("")
    : '<div class="empty-library">Chưa có video.<br>Tải một hoặc nhiều video từ máy.</div>';
  $$(".media-item").forEach(
    (b) => (b.onclick = action(() => selectVideo(b.dataset.id))),
  );
  $("#queueSummary").textContent =
    `${episodes.length} video · ${episodes.filter((e) => ["running", "queued"].includes(e.status)).length} đang xử lý`;
  $("#batchButton").disabled =
    !episodes.length ||
    episodes.some((e) => ["running", "queued"].includes(e.status));
  if (currentTool === "media") $("#itemCount").textContent = episodes.length;
}
function renderCaptionList() {
  const query = $("#captionSearch").value.toLowerCase();
  const filtered = cues
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => (c.vi + " " + c.text).toLowerCase().includes(query));
  $("#captionList").innerHTML = filtered.length
    ? filtered
        .slice(0, captionLimit)
        .map(
          ({ c, i }) =>
            `<button class="caption-card ${i === cueIndex ? "selected" : ""}" data-index="${i}"><time>${String(i + 1).padStart(2, "0")} · ${time(c.start)} → ${time(c.end)}</time><span>${esc(c.vi || c.text || "Câu trống")}</span>${c.vi ? `<small>${esc(c.text)}</small>` : ""}</button>`,
        )
        .join("") +
      (filtered.length > captionLimit
        ? '<button id="moreCaptions" class="text-button full">Hiện thêm câu</button>'
        : "")
    : '<div class="empty-library">' +
      (query
        ? "Không tìm thấy câu phù hợp."
        : "Chưa có phụ đề.<br>Chọn “Tạo phụ đề Việt” để bắt đầu.") +
      "</div>";
  $$(".caption-card").forEach(
    (b) => (b.onclick = () => selectCue(Number(b.dataset.index), true)),
  );
  if ($("#moreCaptions"))
    $("#moreCaptions").onclick = () => {
      captionLimit += 200;
      renderCaptionList();
    };
  if (currentTool === "captions") $("#itemCount").textContent = cues.length;
}
$("#captionSearch").oninput = () => {
  captionLimit = 200;
  renderCaptionList();
};
async function selectVideo(id) {
  await flush();
  const e = await api("/api/episodes/" + id);
  selected = e;
  subtitleTime = 0;
  projectKnowledge = await api("/api/series/" + e.seriesId + "/knowledge");
  cues = e.cues;
  revision = e.revision;
  cueIndex = -1;
  dirty = false;
  captionLimit = 200;
  $("#cueEditor").hidden = true;
  $("#videoTitle").textContent = e.title;
  renderMedia();
  renderCaptionList();
  setPreview(false);
  renderTimeline();
  renderControls();
  if (e.subtitleOnly && cues.length) selectCue(0);
  if (matchMedia("(max-width:650px)").matches)
    $(".library-panel").classList.remove("open");
}
function clearVideo() {
  selected = null;
  cues = [];
  cueIndex = -1;
  dirty = false;
  $("#cueEditor").hidden = true;
  $("#videoTitle").textContent = "Xem trước";
  setPreview(false);
  renderMedia();
  renderCaptionList();
  renderTimeline();
  renderControls();
}
function setPreview(isOutput) {
  if (isOutput && !selected?.output) return;
  outputPreview = isOutput;
  $("#originalPreview").classList.toggle("selected", !isOutput);
  $("#outputPreview").classList.toggle("selected", isOutput);
  const has = selected && (isOutput ? selected.output : selected.source);
  $("#player").pause();
  $("#player").hidden = !has;
  $("#emptyPreview").hidden = !!has || !!selected?.subtitleOnly;
  $("#subtitleWorkspace").hidden = !selected?.subtitleOnly;
  if (has) {
    $("#player").src =
      `/media/${selected.id}/${isOutput ? "output" : "source"}?v=${selected.outputRevision || 0}`;
    $("#player").load();
  } else {
    $("#player").removeAttribute("src");
    $("#player").load();
    $("#mediaInfo").textContent = selected?.subtitleOnly
      ? "SRT · Giữ nguyên timestamp"
      : "—";
  }
  updateOverlay();
}
$("#originalPreview").onclick = () => setPreview(false);
$("#outputPreview").onclick = () => setPreview(true);
function geometry() {
  const p = $("#player"),
    box = $("#preview"),
    ratio =
      p.videoWidth && p.videoHeight ? p.videoWidth / p.videoHeight : 16 / 9;
  const w = Math.min(box.clientWidth, box.clientHeight * ratio),
    h = w / ratio;
  return { w, h, x: (box.clientWidth - w) / 2, y: (box.clientHeight - h) / 2 };
}
function updateOverlay() {
  const g = geometry(),
    overlay = $("#subtitleOverlay");
  overlay.style.left = g.x + g.w * 0.05 + "px";
  overlay.style.width = g.w * 0.9 + "px";
  overlay.style.top = g.y + g.h * 0.83 + "px";
  overlay.style.fontSize = Math.max(12, (g.h * 48) / 1080) + "px";
  overlay.textContent =
    outputPreview || !options.burn
      ? ""
      : cues
          .filter(
            (c) =>
              c.start <= $("#player").currentTime &&
              c.end > $("#player").currentTime,
          )
          .map((c) => c.vi || c.text)
          .join("\n");
  const roi = $("#roiOutline");
  roi.hidden =
    !selected?.source ||
    outputPreview ||
    (options.cover === "none" && options.subtitleMode !== "ocr");
  roi.style.left = g.x + (g.w * options.roiX) / 100 + "px";
  roi.style.top = g.y + (g.h * options.roiY) / 100 + "px";
  roi.style.width = (g.w * options.roiW) / 100 + "px";
  roi.style.height = (g.h * options.roiH) / 100 + "px";
}
function seek(seconds) {
  if (selected?.subtitleOnly) {
    subtitleTime = Math.min(duration(), Math.max(0, seconds));
    updatePlayback();
    return;
  }
  if (!selected?.source) return;
  $("#player").currentTime = Math.min(duration(), Math.max(0, seconds));
  updatePlayback();
}
async function play() {
  if (!selected?.source) return;
  if ($("#player").paused) await $("#player").play();
  else $("#player").pause();
}
$("#playButton").onclick = action(play);
$("#jumpBack").onclick = () => seek($("#player").currentTime - 5);
$("#jumpForward").onclick = () => seek($("#player").currentTime + 5);
function updatePlayback() {
  const currentTime = selected?.subtitleOnly
    ? subtitleTime
    : $("#player").currentTime;
  $("#timeDisplay").textContent =
    time(currentTime) + " / " + time(selected ? duration() : 0);
  $("#playhead").style.left =
    (currentTime / duration()) * $("#timelineCanvas").clientWidth + "px";
  updateOverlay();
}
$("#player").onplay = () => ($("#playButton").textContent = "Ⅱ");
$("#player").onpause = () => ($("#playButton").textContent = "▶");
$("#player").ontimeupdate = updatePlayback;
$("#player").onloadedmetadata = () => {
  $("#mediaInfo").textContent =
    `${$("#player").videoWidth} × ${$("#player").videoHeight}`;
  renderTimeline();
  updatePlayback();
};
$("#player").onerror = () => {
  if (selected?.source)
    notify(
      "Trình duyệt chưa đọc được codec này. Bạn vẫn có thể tạo phụ đề và xuất sang MP4 H.264.",
    );
};
new ResizeObserver(() => {
  updateOverlay();
  updatePlayback();
}).observe($("#preview"));
function renderControls() {
  const locked = busy(),
    has = !!selected?.source;
  $("#playButton").disabled = !has;
  $("#jumpBack").disabled = !has;
  $("#jumpForward").disabled = !has;
  $("#generateButton").disabled = (!has && !cues.length) || locked;
  $("#generateButton").textContent = selected?.subtitleOnly
    ? "✦ Dịch phụ đề sang tiếng Việt"
    : "✦ Tạo phụ đề Việt";
  $("#exportButton").disabled = !has || locked;
  $("#renderButton").disabled =
    !has || locked || !cues.length || cues.some((c) => !c.vi?.trim());
  $("#addCue").disabled = !selected || locked;
  $("#saveCues").disabled = !dirty || locked;
  $("#downloadSrt").disabled = !cues.length || cues.some((c) => !c.vi?.trim());
  $("#outputPreview").disabled = !selected?.output;
  $("#retranslateButton").disabled = !cues.length || locked;
  $("#cueCount").textContent = cues.length + " câu";
  $("#taskStrip").hidden = !locked;
  $("#taskStage").textContent = selected?.stage || "";
  $("#taskProgress").value = selected?.progress || 0;
  $("#cueEditor")
    .querySelectorAll("input,textarea,select,button")
    .forEach((el) => (el.disabled = locked));
  const projectLocked = state.episodes.some(
    (e) => e.seriesId === projectId && ["queued", "running"].includes(e.status),
  );
  for (const id of Object.values(optionMap))
    $("#" + id).disabled = projectLocked;
  $("#engineHint").textContent =
    state.translationEngine === "opus"
      ? "OPUS CPU · Không suy luận ngữ cảnh. Chọn Ollama/Qwen trong cấu hình để nâng chất lượng."
      : "Ngữ cảnh · Nhân vật · Thuật ngữ · Bộ nhớ đã duyệt.";
  if (selected?.status === "failed") $("#taskStrip").hidden = true;
  $("#taskError").hidden = selected?.status !== "failed";
  $("#taskError").textContent =
    selected?.error || "Xử lý chưa thành công. Mở Tiến độ để xem chi tiết.";
  if (cueIndex < 0) $(".generate-card").classList.remove("compact");
  $("#qualityButton").disabled = !selected || !cues.length;
  if ($("#qualityDialog").open) renderQuality();
  renderApproval();
  renderSubtitleWorkspace();
}
$("#toggleGeneration").onclick = () =>
  $(".generate-card").classList.toggle("compact");
$("#taskError").onclick = () => {
  const match = selected?.error?.match(/Câu (\d+)/i);
  if (match && cues[Number(match[1]) - 1])
    selectCue(Number(match[1]) - 1, true);
  else $("#logsButton").click();
};
function selectCue(index, seekTo = false) {
  if (index < 0 || index >= cues.length) return;
  cueIndex = index;
  $(".generate-card").classList.add("compact");
  const c = cues[index];
  $("#cueEditor").hidden = false;
  $("#cueEditorTitle").textContent = "Câu " + (index + 1);
  $("#cueStart").value = c.start.toFixed(3);
  $("#cueEnd").value = c.end.toFixed(3);
  $("#cueSource").value = c.text;
  $("#cueVi").value = c.vi;
  $("#cueVoice").value = c.voice || "";
  const characters = projectKnowledge?.characters || [];
  for (const [id, key] of [
    ["cueSpeaker", "speaker"],
    ["cueListener", "listener"],
  ]) {
    $("#" + id).innerHTML =
      '<option value="">Chưa xác định</option>' +
      characters
        .map(
          (ch) =>
            `<option value="${esc(ch.id)}">${esc(ch.vi)} · ${esc(ch.zh)}</option>`,
        )
        .join("");
    $("#" + id).value = c[key] || "";
  }
  $("#cueScene").value = c.scene || "";
  showInspector("captions");
  $("#cueWarning").hidden = !(c.vi && c.vi.length / (c.end - c.start) > 22);
  $("#cueWarning").textContent =
    "Câu hơi dài. Rút gọn để đọc và lồng tiếng tự nhiên hơn.";
  renderCaptionList();
  $$(".cue-clip").forEach((b) =>
    b.classList.toggle("selected", Number(b.dataset.index) === index),
  );
  if (seekTo) seek(c.start);
  if (matchMedia("(max-width:650px)").matches)
    $(".library-panel").classList.remove("open");
  renderControls();
}
for (const [id, key] of Object.entries({
  cueStart: "start",
  cueEnd: "end",
  cueSource: "text",
  cueVi: "vi",
  cueVoice: "voice",
  cueSpeaker: "speaker",
  cueListener: "listener",
  cueScene: "scene",
}))
  $("#" + id).addEventListener(
    ["cueStart", "cueEnd", "cueVoice", "cueSpeaker", "cueListener"].includes(id)
      ? "change"
      : "input",
    () => {
      if (cueIndex < 0 || busy()) return;
      cues[cueIndex][key] = ["start", "end"].includes(key)
        ? Number($("#" + id).value)
        : $("#" + id).value;
      markDirty();
      renderCaptionList();
      renderTimeline();
      updateOverlay();
    },
  );
$("#nextCue").onclick = () =>
  selectCue(Math.min(cueIndex + 1, cues.length - 1), true);
$("#deleteCue").onclick = () => {
  if (cueIndex < 0 || busy()) return;
  cues.splice(cueIndex, 1);
  cueIndex = Math.min(cueIndex, cues.length - 1);
  markDirty();
  renderCaptionList();
  renderTimeline();
  if (cueIndex >= 0) selectCue(cueIndex);
  else $("#cueEditor").hidden = true;
};
$("#addCue").onclick = () => {
  if (!selected || busy()) return;
  const last = cues.at(-1)?.end || 0,
    start = Math.max(last, $("#player").currentTime || 0),
    end = Math.min(duration(), start + 3);
  if (end <= start)
    return notify(
      "Không còn khoảng trống ở cuối video. Chỉnh thời gian câu cuối trước.",
    );
  cues.push({
    id: String(cues.length + 1),
    start,
    end,
    text: "",
    vi: "",
    voice: "",
  });
  markDirty();
  selectCue(cues.length - 1, true);
  renderTimeline();
};
$("#saveCues").onclick = action(async () => {
  await saveCues();
  notify("Đã lưu phụ đề");
});
$("#downloadSrt").onclick = action(async () => {
  await saveCues();
  const a = document.createElement("a");
  a.href = `/media/${selected.id}/subtitles`;
  a.download = "vietnamese.srt";
  a.click();
});
function renderTimeline() {
  const length = duration(),
    zoom = Number($("#timelineZoom").value),
    canvas = $("#timelineCanvas");
  canvas.style.width = zoom * 100 + "%";
  $("#timelineEmpty").hidden = !!selected;
  $("#ruler").innerHTML = Array.from(
    { length: Math.min(50, Math.round(10 * zoom)) + 1 },
    (_, i) => {
      const count = Math.min(50, Math.round(10 * zoom));
      return `<span style="left:${(i / count) * 100}%">${time((i / count) * length).slice(0, -3)}</span>`;
    },
  ).join("");
  $("#videoTrack").innerHTML = selected
    ? `<div class="video-clip" style="left:0;width:100%">▷ &nbsp; ${esc(selected.title)}</div>`
    : "";
  $("#captionTrack").innerHTML = cues
    .map(
      (c, i) =>
        `<div class="cue-clip ${i === cueIndex ? "selected" : ""}" role="button" tabindex="0" aria-label="Câu ${i + 1}: ${esc(c.vi || c.text)}" data-index="${i}" style="left:${(c.start / length) * 100}%;width:${((c.end - c.start) / length) * 100}%"><span class="clip-handle left" data-edge="start"></span><span class="clip-text">${esc(c.vi || c.text)}</span><span class="clip-handle right" data-edge="end"></span></div>`,
    )
    .join("");
  $("#voiceTrack").innerHTML =
    selected && !selected.subtitleOnly && options.dub
      ? `<div class="voice-clip ${selected.output ? "ready" : ""}" style="left:0;width:100%">♫ ${selected.output ? "Có trong bản xuất" : "Giọng Việt · tạo khi xuất"}</div>`
      : "";
  $$(".cue-clip").forEach((b) => {
    b.onpointerdown = (event) => startDrag(event, b);
    b.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ")
        selectCue(Number(b.dataset.index), true);
    };
  });
  updatePlayback();
}
function startDrag(event, el) {
  if (event.button !== 0 || busy()) return;
  event.preventDefault();
  const index = Number(el.dataset.index),
    c = cues[index],
    edge = event.target.dataset.edge;
  const origin = { ...c },
    startX = event.clientX,
    width = $("#timelineCanvas").clientWidth,
    len = duration();
  let moved = false;
  dragging = true;
  el.setPointerCapture(event.pointerId);
  const move = (e) => {
    const delta = ((e.clientX - startX) / width) * len;
    if (Math.abs(e.clientX - startX) > 3) moved = true;
    const previous = index ? cues[index - 1].end : 0,
      next = cues[index + 1]?.start || len;
    if (edge === "start")
      c.start = Math.min(
        c.end - 0.12,
        Math.max(previous, origin.start + delta),
      );
    else if (edge === "end")
      c.end = Math.max(c.start + 0.12, Math.min(next, origin.end + delta));
    else {
      const span = origin.end - origin.start;
      c.start = Math.max(previous, Math.min(next - span, origin.start + delta));
      c.end = c.start + span;
    }
    el.style.left = (c.start / len) * 100 + "%";
    el.style.width = ((c.end - c.start) / len) * 100 + "%";
  };
  const finish = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", finish);
    el.removeEventListener("pointercancel", finish);
    dragging = false;
    if (moved) {
      c.start = Math.round(c.start * 100) / 100;
      c.end = Math.round(c.end * 100) / 100;
      markDirty();
    }
    selectCue(index, !moved);
    renderTimeline();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
}
$("#ruler").onclick = (e) => {
  const rect = $("#ruler").getBoundingClientRect();
  seek(((e.clientX - rect.left) / rect.width) * duration());
};
$("#videoTrack").onclick = (e) => {
  const r = $("#videoTrack").getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * duration());
};
$("#timelineZoom").oninput = renderTimeline;
$("#zoomIn").onclick = () => {
  $("#timelineZoom").value = Math.min(
    8,
    Number($("#timelineZoom").value) + 0.5,
  );
  renderTimeline();
};
$("#zoomOut").onclick = () => {
  $("#timelineZoom").value = Math.max(
    1,
    Number($("#timelineZoom").value) - 0.5,
  );
  renderTimeline();
};
$("#fitTimeline").onclick = () => {
  $("#timelineZoom").value = 1;
  renderTimeline();
};
async function generate(ids) {
  await flush();
  options.subtitleMode = "auto";
  $("#subtitleMode").value = "auto";
  options.review = true;
  optionsDirty = true;
  await saveOptions();
  await api("/api/queue", { ids, mode: "all" });
  showTool("captions");
  await refresh();
  notify("Đang tạo phụ đề. Bạn có thể theo dõi ngay dưới video.");
}
$("#generateButton").onclick = action(() => generate([selected.id]));
$("#batchButton").onclick = action(() =>
  generate(
    state.episodes
      .filter(
        (e) =>
          e.seriesId === projectId && !["running", "queued"].includes(e.status),
      )
      .map((e) => e.id),
  ),
);
$("#cancelButton").onclick = action(async () => {
  if (selected) await api(`/api/episodes/${selected.id}/cancel`, {});
  await refresh();
});
$("#retranslateButton").onclick = action(async () => {
  if (
    !confirm(
      "Dịch lại sẽ thay lời Việt của các câu CHƯA duyệt; giữ nguyên câu đã duyệt và timestamp. Tiếp tục?",
    )
  )
    return;
  await flush();
  selected = await api(`/api/episodes/${selected.id}/reset-translation`, {});
  cues = selected.cues;
  revision = selected.revision;
  await generate([selected.id]);
});
async function uploadFiles(files) {
  if (uploading) return notify("Đang tải video trước đó, vui lòng chờ.");
  const valid = [...files].filter((f) =>
    /\.(mp4|mkv|mov|webm|avi|flv|m4v)$/i.test(f.name),
  );
  if (!valid.length) throw Error("Chọn tệp video MP4, MKV, MOV hoặc WEBM");
  await flush();
  uploading = true;
  let first;
  try {
    for (const [i, file] of valid.entries()) {
      if (file.size > 20 * 1024 ** 3) throw Error("Tệp vượt giới hạn 20 GB");
      $("#importStatus").textContent =
        `Đang tải ${i + 1}/${valid.length}: ${file.name}`;
      const e = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "POST",
          `/api/upload?seriesId=${projectId}&name=${encodeURIComponent(file.name)}`,
        );
        xhr.setRequestHeader("X-VietStudio", "1");
        xhr.upload.onprogress = (p) => {
          if (p.lengthComputable)
            $("#importStatus").textContent =
              `${file.name} · ${Math.round((p.loaded / p.total) * 100)}%`;
        };
        xhr.onerror = () => reject(Error("Mất kết nối khi tải video"));
        xhr.onload = () => {
          try {
            const j = JSON.parse(xhr.responseText);
            xhr.status < 300 ? resolve(j) : reject(Error(j.error));
          } catch {
            reject(Error("Tải lên thất bại"));
          }
        };
        xhr.send(file);
      });
      first ??= e.id;
      await refresh();
      if (i === 0) await selectVideo(e.id);
    }
    $("#importStatus").textContent = `Đã thêm ${valid.length} video`;
    currentTool = "media";
    showTool("media");
    if (matchMedia("(max-width:650px)").matches)
      $(".library-panel").classList.remove("open");
    notify("Video đã sẵn sàng. Chọn “Tạo phụ đề Việt” để tiếp tục.");
  } finally {
    uploading = false;
    $("#videoUpload").value = "";
  }
}
for (const id of ["importButton", "emptyImport"])
  $("#" + id).onclick = () => $("#videoUpload").click();
$("#videoUpload").onchange = action((e) => uploadFiles(e.target.files));
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#dropOverlay").hidden = false;
  }
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) e.preventDefault();
});
document.addEventListener("dragleave", () => {
  dragDepth--;
  if (dragDepth <= 0) $("#dropOverlay").hidden = true;
});
document.addEventListener(
  "drop",
  action(async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("#dropOverlay").hidden = true;
    await uploadFiles(e.dataTransfer.files);
  }),
);
$("#importSubtitleButton").onclick = () => {
  if (!selected) return notify("Chọn video trước khi nhập phụ đề");
  $("#subtitleDialog").showModal();
};
$("#chooseSubtitleFile").onclick = () => $("#subtitleUpload").click();
$("#subtitleUpload").onchange = action(async (e) => {
  if (!selected) return;
  const f = e.target.files[0];
  if (!f) return;
  await flush();
  selected = await api(`/api/episodes/${selected.id}/subtitles`, {
    content: await f.text(),
    language: $("#subtitleLanguage").value,
  });
  cues = selected.cues;
  revision = selected.revision;
  dirty = false;
  $("#subtitleDialog").close();
  renderCaptionList();
  renderTimeline();
  renderControls();
  if (cues.length) selectCue(0, true);
  e.target.value = "";
});
$("#seriesSelect").onchange = action(async (e) => {
  const target = e.target.value;
  try {
    await flush();
  } catch (err) {
    e.target.value = projectId;
    throw err;
  }
  projectId = target;
  localStorage.setItem("projectId", projectId);
  options = structuredClone(project().options);
  optionsDirty = false;
  clearVideo();
  applyOptions();
  const first = state.episodes.find((e) => e.seriesId === projectId);
  if (first) await selectVideo(first.id);
});
$("#newProject").onclick = () => {
  $("#projectName").value = "";
  $("#projectDialog").showModal();
  $("#projectName").focus();
};
$("#deleteProject").onclick = action(async () => {
  const p = project();
  if (uploading || state.episodes.some(e => e.seriesId === p.id && ["running", "queued", "uploading"].includes(e.status)))
    return notify("Dừng xử lý và đợi tải lên hoàn tất trước khi xóa dự án.");
  if (!confirm(`Xóa dự án “${p.title}” khỏi danh sách? Video, phụ đề và bản dịch được giữ trong mục Dự án đã xóa để bạn có thể khôi phục.`)) return;
  await flush();
  await api('/api/series/' + p.id, {}, 'DELETE');
  clearVideo();
  await refresh();
  options = structuredClone(project().options);
  optionsDirty = false;
  applyOptions();
  localStorage.setItem('projectId', projectId);
  notify('Đã chuyển dự án vào mục đã xóa. Bấm ↶ để khôi phục.');
});
$("#projectTrash").onclick = action(async () => {
  const entries = await api('/api/trash');
  if (!entries.length) return notify('Chưa có dự án đã xóa.');
  const choice = prompt('Nhập số dự án cần khôi phục:\n' + entries.map((p,i) => `${i+1}. ${p.title}`).join('\n'));
  if (choice === null) return;
  const index = Number(choice) - 1;
  if (!Number.isInteger(index) || !entries[index]) return notify('Số dự án không hợp lệ.');
  await api('/api/series/' + entries[index].id + '/restore', {});
  await refresh();
  notify('Đã khôi phục dự án. Bạn có thể chọn lại trong danh sách.');
});
$("#projectForm").onsubmit = action(async (e) => {
  e.preventDefault();
  await flush();
  const p = await api("/api/series", { title: $("#projectName").value.trim() });
  projectId = p.id;
  localStorage.setItem("projectId", projectId);
  $("#projectDialog").close();
  await refresh();
  options = structuredClone(p.options);
  optionsDirty = false;
  clearVideo();
  applyOptions();
});
$("#exportButton").onclick = action(async () => {
  await flush();
  $("#exportTitle").textContent = selected.title;
  $("#exportSummary").textContent =
    `${cues.length} câu phụ đề · ${options.dub ? "Có giọng đọc Việt" : "Giữ âm thanh gốc"} · ${options.burn ? "Gắn phụ đề vào video" : "Không gắn phụ đề"}`;
  $("#exportResult").hidden =
    !selected.output || selected.outputRevision !== revision;
  $("#downloadOutput").href = `/media/${selected.id}/output?download=1`;
  $("#exportProgress").hidden = true;
  $("#exportError").hidden = !!cues.length && !cues.some((c) => !c.vi?.trim());
  $("#exportError").textContent =
    "Tạo hoặc nhập bản dịch tiếng Việt đầy đủ trước khi xuất.";
  exportingId = selected.id;
  $("#exportDialog").showModal();
  renderControls();
});
$("#renderButton").onclick = action(async () => {
  await flush();
  $("#exportError").hidden = true;
  await api("/api/queue", { ids: [selected.id], mode: "render" });
  exportingId = selected.id;
  $("#exportResult").hidden = true;
  $("#exportProgress").hidden = false;
  await refresh();
});
async function refresh() {
  state = await api("/api/state");
  if (!state.series.some((s) => s.id === projectId))
    projectId = state.series[0]?.id;
  const projectMarkup = state.series
    .map((s) => `<option value="${s.id}">${esc(s.title)}</option>`)
    .join("");
  if ($("#seriesSelect").innerHTML !== projectMarkup)
    $("#seriesSelect").innerHTML = projectMarkup;
  $("#seriesSelect").value = projectId;
  $("#connection").textContent = "Local · Đã kết nối";
  renderMedia();
  if (selected) {
    const id = selected.id,
      e = await api("/api/episodes/" + id);
    if (selected?.id !== id) return;
    const oldStatus = selected.status;
    selected = e;
    if (!dirty && !saving && !dragging && revision !== e.revision) {
      cues = e.cues;
      revision = e.revision;
      renderCaptionList();
      renderTimeline();
      if (cueIndex >= 0) selectCue(Math.min(cueIndex, cues.length - 1));
    }
    if (!$("#player").getAttribute("src") && e.source) setPreview(false);
    if (oldStatus !== e.status && e.status === "review") {
      notify("Phụ đề Việt đã sẵn sàng. Chọn một câu để chỉnh sửa.");
      showTool("captions");
      if (cues.length) selectCue(0);
    }
    if (oldStatus !== e.status && e.status === "failed")
      notify(e.error || "Tác vụ gặp lỗi");
    renderControls();
    $("#logs").textContent =
      e.logs
        ?.map(
          (l) =>
            `${new Date(l.time).toLocaleTimeString("vi-VN")}  ${l.message}`,
        )
        .join("\n") || "Chưa có tác vụ.";
    if ($("#exportDialog").open && exportingId === e.id) {
      $("#exportProgress").hidden = !["queued", "running"].includes(e.status);
      $("#exportBar").value = e.progress;
      $("#exportStage").textContent = e.stage;
      if (e.status === "completed") {
        const fresh = e.outputRevision === e.revision;
        $("#exportResult").hidden = !fresh;
        $("#downloadOutput").href = `/media/${e.id}/output?download=1`;
        $("#renderButton").textContent = "Xuất lại";
      }
      if (e.status === "failed") {
        $("#exportError").hidden = false;
        $("#exportError").textContent = e.error;
      }
    }
  } else renderControls();
}
$("#logsButton").onclick = () => {
  $("#allJobs").innerHTML =
    state.episodes
      .filter((e) => e.seriesId === projectId)
      .map(
        (e) =>
          `<div class="job-row"><span>${esc(e.title)}</span><span>${statusText[e.status]} ${e.progress || 0}%</span></div>`,
      )
      .join("") || '<p class="helper">Chưa có video.</p>';
  $("#logsDialog").showModal();
};
$("#cancelAll").onclick = action(async () => {
  for (const e of state.episodes.filter(
    (e) => e.seriesId === projectId && ["queued", "running"].includes(e.status),
  ))
    await api(`/api/episodes/${e.id}/cancel`, {});
  await refresh();
  notify("Đã dừng hàng đợi dự án");
});
const pathLabels = {
  ffmpeg: "FFmpeg",
  ffprobe: "FFprobe",
  ytdlp: "yt-dlp",
  whisper: "Whisper executable",
  whisperModel: "Mô hình Whisper",
  python: "Python trong .venv",
  voicesDir: "Thư mục giọng Việt",
  opusModel: "Thư mục OPUS CPU",
  llama: "llama-server",
  llamaModel: "Mô hình LLM GGUF",
  cookies: "Tệp cookies (chức năng URL để sau)",
};
function renderApproval() {
  const approved =
    !dirty && selected?.approvedIds?.includes(cues[cueIndex]?.id);
  $("#approvalHint").textContent = approved
    ? "✓ Đã duyệt và ghi nhớ"
    : "Chưa duyệt · Sửa câu sẽ hủy trạng thái duyệt cũ.";
  $("#approveCue").disabled = busy() || cueIndex < 0 || !cues[cueIndex]?.vi;
  $("#approveCue").textContent = approved
    ? "Bỏ duyệt câu này"
    : "Duyệt câu & ghi nhớ";
}
function renderSubtitleWorkspace() {
  if (!selected?.subtitleOnly) return;
  const c = cues[cueIndex];
  for (const [id, key] of [
    ["capcutSource", "text"],
    ["capcutVi", "vi"],
  ]) {
    const el = $("#" + id);
    if (document.activeElement !== el) el.value = c?.[key] || "";
    el.disabled = !c || !!busy();
  }
  $("#capcutPosition").textContent = c
    ? `Câu ${cueIndex + 1}/${cues.length} · ${time(c.start)} → ${time(c.end)}`
    : "Chọn câu để chỉnh sửa";
  $("#capcutPrevious").disabled = cueIndex <= 0;
  $("#capcutNext").disabled = cueIndex >= cues.length - 1;
  $("#capcutDownload").disabled =
    !cues.length || cues.some((q) => !q.vi?.trim());
  $("#capcutTranslate").disabled = !!busy() || !cues.length;
}
for (const [id, key, other] of [
  ["capcutSource", "text", "cueSource"],
  ["capcutVi", "vi", "cueVi"],
])
  $("#" + id).oninput = () => {
    if (cueIndex < 0 || busy()) return;
    cues[cueIndex][key] = $("#" + id).value;
    $("#" + other).value = $("#" + id).value;
    markDirty();
    renderCaptionList();
    renderTimeline();
    renderApproval();
  };
$("#capcutPrevious").onclick = () => selectCue(Math.max(0, cueIndex - 1));
$("#capcutNext").onclick = () =>
  selectCue(Math.min(cues.length - 1, cueIndex + 1));
$("#capcutDownload").onclick = () => $("#downloadSrt").click();
$("#capcutTranslate").onclick = action(() => generate([selected.id]));
$("#importCapcut").onclick = () => $("#capcutFiles").click();
$("#capcutFiles").onchange = action(async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  await flush();
  let last;
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) throw Error("Phụ đề vượt giới hạn 8 MB");
    last = await api("/api/subtitle-project", {
      seriesId: projectId,
      title: file.name,
      content: await file.text(),
    });
  }
  event.target.value = "";
  await refresh();
  await selectVideo(last.id);
  showTool("captions");
  notify(`Đã nhập ${files.length} tệp phụ đề. Bấm dịch để tạo SRT tiếng Việt.`);
});
$("#approveCue").onclick = action(async () => {
  await flush();
  const approved = selected.approvedIds?.includes(cues[cueIndex].id);
  selected = await api(
    `/api/episodes/${selected.id}/${approved ? "unapprove" : "approve"}`,
    {
      revision,
      ids: [cues[cueIndex].id],
    },
  );
  renderApproval();
  notify(
    approved
      ? "Đã bỏ duyệt, câu không còn được dùng làm bộ nhớ."
      : "Đã duyệt câu và ghi vào bộ nhớ của dự án",
  );
});
let knowledgeDraft,
  knowledgeTab = "story",
  knowledgeProject;
const knowledgeFields = {
  terms: [
    ["source", "Tiếng Trung"],
    ["target", "Tiếng Việt thống nhất"],
    ["notes", "Ghi chú"],
  ],
  characters: [
    ["id", "ID (ví dụ: em_gai)"],
    ["zh", "Tên Trung"],
    ["vi", "Tên Việt"],
    ["aliases", "Tên khác, ngăn bởi dấu phẩy"],
    ["description", "Vai trò, tuổi, tính cách"],
  ],
  relations: [
    ["from", "Người nói (ID)"],
    ["to", "Người nghe (ID)"],
    ["self", "Tự xưng (em / tôi / ta…)"],
    ["address", "Gọi đối phương (chị / anh…)"],
    ["description", "Quan hệ và hoàn cảnh"],
  ],
  notes: [
    ["title", "Tiêu đề"],
    ["episodeOrder", "Sau tập số (0 = toàn truyện)"],
    ["content", "Sự kiện đã xác nhận / tóm tắt đã duyệt"],
  ],
};
function captureKnowledge() {
  if (!knowledgeDraft || knowledgeTab === "memory") return;
  if (knowledgeTab === "story") {
    knowledgeDraft.synopsis = $("#storySynopsis").value;
    return;
  }
  knowledgeDraft[knowledgeTab] = $$("#knowledgeContent .knowledge-row").map(
    (row) => {
      const result = {};
      row
        .querySelectorAll("[data-field]")
        .forEach(
          (el) =>
            (result[el.dataset.field] =
              el.type === "checkbox"
                ? el.checked
                : el.type === "number"
                  ? Number(el.value)
                  : el.value),
        );
      return result;
    },
  );
}
async function renderKnowledge() {
  $$("#knowledgeTabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.kTab === knowledgeTab),
  );
  if (knowledgeTab === "story") {
    $("#knowledgeContent").innerHTML =
      `<label>Cốt truyện và quy ước chung<textarea id="storySynopsis" rows="10" placeholder="Thể loại, bối cảnh, quan hệ đã biết, cách chuyển tên…">${esc(knowledgeDraft.synopsis)}</textarea></label><p class="helper">Không ghi sự kiện tương lai vào bối cảnh toàn truyện. Đặt chúng ở Ghi chú tập để giới hạn phạm vi truy xuất.</p>`;
    return;
  }
  if (knowledgeTab === "memory") {
    const target = selected?.id;
    if (!target) {
      $("#knowledgeContent").textContent = "Chọn video để xem bộ nhớ.";
      return;
    }
    const m = await api(`/api/episodes/${target}/memory`);
    if (knowledgeTab !== "memory") return;
    $("#knowledgeContent").innerHTML =
      `<p class="helper">${m.entries.length} mục đang hiển thị (tối đa 300, từ tập này trở về trước). Khớp nguồn và ngữ cảnh mới tự dùng lại; các mục khác chỉ làm tham khảo. Sửa bản gốc đã duyệt sẽ loại mục cũ khỏi truy xuất.</p>` +
      m.entries
        .map(
          (r) =>
            `<div class="quality-card"><small>Tập ${r.order} · Câu ${esc(r.id)} · ${esc(r.speaker || "Chưa rõ người nói")}</small><p>${esc(r.text)}</p><p>${esc(r.vi)}</p></div>`,
        )
        .join("");
    return;
  }
  const fields = knowledgeFields[knowledgeTab];
  $("#knowledgeContent").innerHTML =
    knowledgeDraft[knowledgeTab]
      .map(
        (item, index) =>
          `<div class="knowledge-row">${fields
            .map(([key, label]) => {
              const long = ["description", "content", "notes"].includes(key);
              const input =
                knowledgeTab === "relations" && ["from", "to"].includes(key)
                  ? `<select data-field="${key}"><option value="">Chọn nhân vật</option>${knowledgeDraft.characters.map((c) => `<option value="${esc(c.id)}" ${item[key] === c.id ? "selected" : ""}>${esc(c.vi)} (${esc(c.id)})</option>`).join("")}</select>`
                  : long
                    ? `<textarea data-field="${key}">${esc(item[key] || "")}</textarea>`
                    : `<input data-field="${key}" ${key === "episodeOrder" ? 'type="number" min="0" max="10000"' : ""} value="${esc(item[key] ?? "")}">`;
              return `<label class="${long ? "wide" : ""}">${label}${input}</label>`;
            })
            .join(
              "",
            )}${knowledgeTab === "terms" ? `<label class="check-label"><input type="checkbox" data-field="strict" ${item.strict !== false ? "checked" : ""}>Kiểm tra bắt buộc dùng đúng thuật ngữ</label>` : ""}<button class="text-button" data-remove-k="${index}">Xóa mục</button></div>`,
      )
      .join("") +
    '<button id="addKnowledgeItem" class="button">＋ Thêm mục</button>';
  $("#addKnowledgeItem").onclick = () => {
    captureKnowledge();
    knowledgeDraft[knowledgeTab].push({});
    renderKnowledge();
  };
  $$("[data-remove-k]").forEach(
    (b) =>
      (b.onclick = () => {
        captureKnowledge();
        knowledgeDraft[knowledgeTab].splice(Number(b.dataset.removeK), 1);
        renderKnowledge();
      }),
  );
}
$("#knowledgeButton").onclick = action(async () => {
  await flush();
  knowledgeProject = projectId;
  knowledgeDraft = await api("/api/series/" + projectId + "/knowledge");
  knowledgeTab = "story";
  $("#knowledgeStatus").textContent = "Phiên bản " + knowledgeDraft.version;
  await renderKnowledge();
  $("#knowledgeDialog").showModal();
});
$$("[data-k-tab]").forEach(
  (b) =>
    (b.onclick = action(async () => {
      captureKnowledge();
      knowledgeTab = b.dataset.kTab;
      await renderKnowledge();
    })),
);
$("#saveKnowledge").onclick = action(async () => {
  captureKnowledge();
  projectKnowledge = knowledgeDraft = await api(
    "/api/series/" + knowledgeProject + "/knowledge",
    knowledgeDraft,
    "PUT",
  );
  $("#knowledgeStatus").textContent =
    "Đã lưu · Phiên bản " + knowledgeDraft.version;
  if (cueIndex >= 0) selectCue(cueIndex);
  await refresh();
  notify("Đã lưu tri thức; bản dịch đã có được giữ nguyên.");
});
function renderQuality() {
  if (!selected) return;
  const q = selected.quality,
    stale = dirty || selected.qualityStale;
  const label = {
    complete: "AI đã kiểm tra",
    rules_only: "Chỉ kiểm tra quy tắc · chưa kiểm tra ngữ nghĩa AI",
    running: "Đang kiểm tra",
    interrupted: "Kiểm tra gián đoạn",
    unavailable: "AI chưa kiểm tra xong",
  };
  $("#qualitySummary").textContent =
    `${selected.approvedIds?.length || 0}/${cues.length} câu được bạn duyệt · ${q ? label[q.status] : "Chưa kiểm tra"}${stale ? " · Kết quả đã cũ, cần kiểm tra lại" : ""}${q?.reason ? " · " + q.reason : ""}`;
  for (const id of [
    "runQuality",
    "approveAll",
    "translateMissing",
    "saveOrder",
  ])
    $("#" + id).disabled = !!busy();
  if (document.activeElement !== $("#episodeOrder"))
    $("#episodeOrder").value = selected.order || 1;
  const signature = JSON.stringify([q, stale, busy()]);
  if ($("#qualityIssues").dataset.signature === signature) return;
  $("#qualityIssues").dataset.signature = signature;
  $("#qualityIssues").innerHTML = !q
    ? '<p class="helper">Bấm AI kiểm tra để phát hiện sai nghĩa, bỏ sót và xưng hô. Đề xuất không tự thay bản dịch; bạn quyết định áp dụng và duyệt.</p>'
    : q.issues.length
      ? q.issues
          .map(
            (issue, index) =>
              `<article class="quality-card ${issue.severity}"><button class="text-button" data-issue-cue="${esc(issue.id)}">Câu ${esc(issue.id)} · ${esc(issue.type)}</button> <small>${issue.source === "ai" ? "AI đánh giá" : "Quy tắc kiểm tra"}</small><p>${esc(issue.message)}</p>${issue.suggestion ? `<p>Đề xuất: ${esc(issue.suggestion)}</p><button class="button" data-apply-issue="${index}" ${stale || busy() ? "disabled" : ""}>Áp dụng đề xuất này</button>` : ""}</article>`,
          )
          .join("")
      : `<p class="helper">${q.status === "complete" ? "Không phát hiện lỗi trong lần kiểm tra này. Kết quả AI không thay thế việc duyệt của bạn." : "Chưa có cảnh báo quy tắc."}</p>`;
  $$("[data-issue-cue]").forEach(
    (b) =>
      (b.onclick = () => {
        $("#qualityDialog").close();
        selectCue(
          cues.findIndex((c) => c.id === b.dataset.issueCue),
          true,
        );
      }),
  );
  $$("[data-apply-issue]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        await flush();
        selected = await api(`/api/episodes/${selected.id}/quality-apply`, {
          revision,
          issueIndex: Number(b.dataset.applyIssue),
        });
        cues = selected.cues;
        revision = selected.revision;
        renderCaptionList();
        renderTimeline();
        renderQuality();
        if (cueIndex >= 0) selectCue(cueIndex);
        notify(
          "Đã áp dụng đề xuất, giữ nguyên thời gian. Kiểm tra lại trước khi duyệt.",
        );
      })),
  );
}
$("#qualityButton").onclick = action(async () => {
  await flush();
  await refresh();
  renderQuality();
  $("#qualityDialog").showModal();
});
$("#runQuality").onclick = action(async () => {
  await flush();
  await api("/api/queue", { ids: [selected.id], mode: "quality" });
  await refresh();
});
$("#translateMissing").onclick = action(async () => {
  await flush();
  await api("/api/queue", { ids: [selected.id], mode: "translate" });
  await refresh();
});
$("#approveAll").onclick = action(async () => {
  await flush();
  selected = await api(`/api/episodes/${selected.id}/approve`, {
    revision,
    ids: cues.map((c) => c.id),
  });
  renderQuality();
  renderApproval();
  notify("Đã ghi nhớ những câu bạn xác nhận duyệt.");
});
$("#saveOrder").onclick = action(async () => {
  await flush();
  selected = await api(`/api/episodes/${selected.id}/order`, {
    revision,
    order: Number($("#episodeOrder").value),
  });
  await refresh();
});
for (const [button, mode] of [
  ["translateSeries", "translate"],
  ["qualitySeries", "quality"],
])
  $("#" + button).onclick = action(async () => {
    await flush();
    const episodes = state.episodes.filter(
      (e) =>
        e.seriesId === projectId &&
        e.cueCount &&
        !["running", "queued"].includes(e.status),
    );
    const details = await Promise.all(
      episodes.map((e) => api("/api/episodes/" + e.id)),
    );
    const ids = details
      .filter((e) =>
        mode === "translate"
          ? e.cues.some((c) => !c.vi?.trim())
          : e.cues.some((c) => c.vi?.trim()),
      )
      .map((e) => e.id);
    if (!ids.length) return notify("Không có tập cần xử lý.");
    await api("/api/queue", { ids, mode });
    await refresh();
    notify(`Đã xếp hàng ${ids.length} tập`);
  });
$("#settingsButton").onclick = action(async () => {
  const c = await api("/api/settings");
  $("#settingsForm").innerHTML =
    `<label class="wide">Bộ dịch<select name="translationEngine"><option value="opus" ${c.translationEngine === "opus" ? "selected" : ""}>OPUS · CPU, nhẹ, cần duyệt bản dịch</option><option value="llm" ${c.translationEngine === "llm" ? "selected" : ""}>LLM · llama.cpp</option><option value="ollama" ${c.translationEngine === "ollama" ? "selected" : ""}>Ollama + Qwen · Local có ngữ cảnh</option><option value="api" ${c.translationEngine === "api" ? "selected" : ""}>API AI · Tùy chọn gửi dữ liệu ra ngoài</option></select></label><label>Máy chủ LLM<input name="llmUrl" value="${esc(c.llmUrl)}"></label><label>Tên mô hình<input name="llmModel" value="${esc(c.llmModel)}"></label><label class="check-label wide"><input name="managedLlm" type="checkbox" ${c.managedLlm ? "checked" : ""}> Tự nạp và đóng mô hình llama.cpp (không áp dụng Ollama)</label>
<label>Ollama URL<input name="ollamaUrl" value="${esc(c.ollamaUrl)}"></label><label>Ollama model<input name="ollamaModel" value="${esc(c.ollamaModel)}"></label>
<label>Context (token)<input name="contextSize" type="number" min="2048" max="16384" value="${c.contextSize}"></label>
<label class="check-label"><input type="checkbox" name="forceCpu" ${c.forceCpu ? "checked" : ""}> Chạy LLM bằng CPU</label>
<label class="check-label"><input type="checkbox" name="cpuFallback" ${c.cpuFallback ? "checked" : ""}> Ollama thử CPU khi lỗi GPU</label>
<label class="check-label"><input type="checkbox" name="autoReview" ${c.autoReview ? "checked" : ""}> AI kiểm tra sau khi dịch</label>
<details><summary>API AI tùy chọn</summary><p class="helper">Khi chọn API và bật bên dưới, phụ đề, hồ sơ nhân vật và ngữ cảnh truy xuất sẽ được gửi tới nhà cung cấp đã cấu hình. Khóa chỉ đọc từ biến môi trường của server.</p><label>API URL (HTTPS, có /v1)<input name="apiUrl" value="${esc(c.apiUrl)}"></label><label>Model API<input name="apiModel" value="${esc(c.apiModel)}"></label><label>Tên biến môi trường khóa API<input name="apiKeyEnv" value="${esc(c.apiKeyEnv)}"></label><label class="check-label"><input type="checkbox" name="allowRemote" ${c.allowRemote ? "checked" : ""}> Cho phép gửi dữ liệu dịch đến API này</label></details><details><summary>Đường dẫn công cụ & mô hình</summary><div class="settings-paths">${Object.entries(
      pathLabels,
    )
      .map(
        ([key, label]) =>
          `<label>${label}<input name="${key}" value="${esc(c[key])}"></label>`,
      )
      .join(
        "",
      )}</div></details><details><summary>Hiệu năng</summary><div class="settings-paths">${Object.entries(
      {
        threads: "Luồng CPU",
        batchSize: "Câu mỗi lượt dịch",
        gpuLayers: "Số lớp GPU (0 = CPU)",
        maxSpeed: "Tốc độ giọng tối đa",
      },
    )
      .map(
        ([key, label]) =>
          `<label>${label}<input name="${key}" type="number" step="${key === "maxSpeed" ? ".05" : "1"}" value="${c[key]}"></label>`,
      )
      .join(
        "",
      )}</div><label class="check-label"><input name="ocrDirectML" type="checkbox" ${c.ocrDirectML ? "checked" : ""}> OCR DirectML (cần runtime tương ứng)</label></details><button type="submit" class="button primary wide">Lưu cấu hình</button>`;
  $("#settingsDialog").showModal();
});
$("#settingsForm").onsubmit = action(async (e) => {
  e.preventDefault();
  const data = {};
  for (const el of e.currentTarget.elements)
    if (el.name) data[el.name] = el.type === "checkbox" ? el.checked : el.value;
  await api("/api/settings", data, "PUT");
  notify("Đã lưu cấu hình");
  await refresh();
});
$("#checkHealth").onclick = action(async () => {
  $("#healthGrid").innerHTML = '<p class="helper">Đang kiểm tra…</p>';
  const health = await api("/api/health");
  $("#healthGrid").innerHTML = health.checks
    .map(
      (c) =>
        `<div class="health-card"><strong>${esc(c.name)} <span class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "!"}</span></strong><p>${esc(c.detail)}</p></div>`,
    )
    .join("");
});
document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
    document.activeElement?.tagName,
  );
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    flush()
      .then(() => notify("Đã lưu"))
      .catch((err) => notify(err.message));
    return;
  }
  if (e.code === "Space" && !typing && !$("dialog[open]")) {
    e.preventDefault();
    play().catch((err) => notify(err.message));
  }
  if (e.key === "Escape") {
    $("#inspector").classList.remove("open");
    $(".library-panel").classList.remove("open");
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty || optionsDirty || uploading) {
    e.preventDefault();
    e.returnValue = "";
  }
});
try {
  await refresh();
  options = structuredClone(project().options);
  applyOptions();
  const first = state.episodes.find((e) => e.seriesId === projectId);
  if (first) await selectVideo(first.id);
  renderTimeline();
} catch (e) {
  notify(e.message);
}
setInterval(async () => {
  if (polling || document.hidden || dragging) return;
  polling = true;
  try {
    await refresh();
  } catch {
    $("#connection").textContent = "Mất kết nối · đang thử lại";
  } finally {
    polling = false;
  }
}, 2000);
if (document.modelContext?.registerTool) {
  document.modelContext.registerTool({
    name: "read_video_queue",
    description: "Đọc video và tiến độ trong dự án Việt Studio đang mở.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      if (!input || Object.keys(input).length)
        throw Error("Công cụ không nhận tham số");
      await refresh();
      return {
        project: project()?.title,
        episodes: state.episodes
          .filter((e) => e.seriesId === projectId)
          .map((e) => ({
            id: e.id,
            title: e.title,
            status: e.status,
            progress: e.progress,
          })),
      };
    },
  });
}

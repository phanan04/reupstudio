import fs from "node:fs/promises";
import path from "node:path";
const base = "http://127.0.0.1:8765";
async function api(url, data, method = "POST") {
  const r = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", "X-VietStudio": "1" },
    body: JSON.stringify(data),
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error);
  return j;
}
const previous = JSON.parse(
  await fs.readFile("data/e2e-verification/result.json", "utf8"),
);
const dir = path.resolve("data/e2e-verification/episodes", previous.id);
const s = await api("/api/series", {
  title: "Kiểm chứng pipeline · video tự sinh 16 giây",
});
await api(
  "/api/series/" + s.id,
  {
    options: {
      review: false,
      cover: "box",
      originalVolume: 0.06,
      outputHeight: 480,
    },
  },
  "PUT",
);
const res = await fetch(
  base + "/api/upload?seriesId=" + s.id + "&name=Kiem-chung-16-giay.mp4",
  {
    method: "POST",
    headers: { "X-VietStudio": "1" },
    body: await fs.readFile(path.join(dir, "source.mp4")),
  },
);
const e = await res.json();
if (!res.ok) throw Error(e.error);
await api(
  "/api/episodes/" + e.id + "/cues",
  { cues: previous.cues, revision: 0 },
  "PUT",
);
await api("/api/queue", { ids: [e.id], mode: "render" });
let result;
for (let i = 0; i < 180; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  result = await (await fetch(base + "/api/episodes/" + e.id)).json();
  if (result.status === "completed") break;
  if (result.status === "failed") throw Error(result.error);
}
if (result.status !== "completed") throw Error("API render did not complete");
console.log(
  JSON.stringify(
    {
      seriesId: s.id,
      episodeId: e.id,
      status: result.status,
      output: base + "/media/" + e.id + "/output",
    },
    null,
    2,
  ),
);
await fs.writeFile(
  "data/verification/api-result.json",
  JSON.stringify({ seriesId: s.id, episodeId: e.id }, null, 2),
);

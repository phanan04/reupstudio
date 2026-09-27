import { hash } from "./core.mjs";

export const emptyKnowledge = () => ({
  version: 0,
  synopsis: "",
  terms: [],
  characters: [],
  relations: [],
  notes: [],
});
const text = (v, max = 2000) => {
  if (typeof v !== "string" || v.length > max)
    throw Error("Nội dung tri thức không hợp lệ");
  return v.trim();
};
export function validateKnowledge(value) {
  const k = emptyKnowledge();
  k.synopsis = text(value.synopsis || "", 10000);
  const array = (name, max) => {
    const a = value[name] || [];
    if (!Array.isArray(a) || a.length > max)
      throw Error("Quá nhiều mục " + name);
    return a;
  };
  k.terms = array("terms", 500).map((t) => ({
    source: text(t.source, 120),
    target: text(t.target, 160),
    notes: text(t.notes || "", 500),
    strict: t.strict !== false,
  }));
  k.characters = array("characters", 100).map((c) => ({
    id: text(c.id, 60),
    zh: text(c.zh || "", 120),
    vi: text(c.vi, 120),
    aliases: text(c.aliases || "", 300),
    description: text(c.description || "", 1000),
  }));
  if (
    new Set(k.characters.map((c) => c.id)).size !== k.characters.length ||
    k.characters.some((c) => !/^[\w-]+$/.test(c.id) || !c.vi)
  )
    throw Error("ID nhân vật phải duy nhất, dùng chữ Latin, số hoặc gạch nối");
  const ids = new Set(k.characters.map((c) => c.id));
  k.relations = array("relations", 300).map((r) => {
    if (!ids.has(r.from) || !ids.has(r.to))
      throw Error("Quan hệ phải chọn nhân vật có trong danh sách");
    return {
      from: r.from,
      to: r.to,
      self: text(r.self || "", 60),
      address: text(r.address || "", 60),
      description: text(r.description || "", 600),
    };
  });
  if (
    new Set(k.relations.map((r) => r.from + ":" + r.to)).size !==
    k.relations.length
  )
    throw Error("Mỗi cặp người nói/người nghe chỉ có một quy tắc");
  k.notes = array("notes", 300).map((n) => {
    const episodeOrder = Number(n.episodeOrder || 0);
    if (
      !Number.isInteger(episodeOrder) ||
      episodeOrder < 0 ||
      episodeOrder > 10000
    )
      throw Error("Thứ tự tập không hợp lệ");
    return {
      title: text(n.title || "", 160),
      content: text(n.content, 4000),
      episodeOrder,
    };
  });
  if (k.terms.some((t) => !t.source || !t.target))
    throw Error("Thuật ngữ cần đủ bản Trung và Việt");
  return k;
}
export function initKnowledge(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS knowledge(series_id TEXT PRIMARY KEY REFERENCES series(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS translation_memory(id TEXT PRIMARY KEY, series_id TEXT NOT NULL, episode_id TEXT NOT NULL, cue_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tm_series ON translation_memory(series_id);
    CREATE TABLE IF NOT EXISTS approvals(episode_id TEXT NOT NULL,cue_id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(episode_id,cue_id));`);
}
export function getKnowledge(store, seriesId) {
  const r = store.db
    .prepare("SELECT data FROM knowledge WHERE series_id=?")
    .get(seriesId);
  return r ? JSON.parse(r.data) : emptyKnowledge();
}
export function putKnowledge(store, seriesId, value, version) {
  if (!store.series(seriesId)) throw Error("Không tìm thấy dự án");
  const old = getKnowledge(store, seriesId);
  if (version !== old.version)
    throw Error("Tri thức đã thay đổi. Mở lại trước khi lưu.");
  const k = { ...validateKnowledge(value), version: old.version + 1 };
  store.db
    .prepare("INSERT OR REPLACE INTO knowledge VALUES(?,?)")
    .run(seriesId, JSON.stringify(k));
  return k;
}
export const cueFingerprint = (c) =>
  hash([
    c.id,
    c.start,
    c.end,
    c.text,
    c.vi,
    c.speaker || "",
    c.listener || "",
    c.scene || "",
  ]);
export function approvalState(store, e) {
  const rows = store.db
    .prepare("SELECT cue_id,fingerprint FROM approvals WHERE episode_id=?")
    .all(e.id);
  return e.cues
    .filter((c) =>
      rows.some(
        (r) => r.cue_id === c.id && r.fingerprint === cueFingerprint(c),
      ),
    )
    .map((c) => c.id);
}
export const orderOf = (store, e) =>
  e.order || store.episodes(e.seriesId).findIndex((q) => q.id === e.id) + 1;
export function scopeKey(store, e) {
  const o = store.series(e.seriesId).options;
  return hash([
    getKnowledge(store, e.seriesId).version,
    o.context,
    o.glossary,
    o.style,
  ]);
}
export function memoryKey(cues, index, scope) {
  const c = cues[index];
  // Context-sensitive exact matching. Ambiguous repeated words are only suggestions.
  return hash([
    scope,
    c.text,
    c.speaker || "",
    c.listener || "",
    c.scene || "",
    cues[index - 1]?.text || "",
    cues[index + 1]?.text || "",
  ]);
}
export function approveCues(store, e, ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => !e.cues.some((c) => c.id === id))
  )
    throw Error("Chọn câu hợp lệ để duyệt");
  const scope = scopeKey(store, e),
    date = new Date().toISOString();
  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const id of new Set(ids)) {
      const index = e.cues.findIndex((c) => c.id === id),
        c = e.cues[index];
      if (!c.vi?.trim() || !c.text?.trim())
        throw Error("Cần cả câu Trung và Việt trước khi ghi nhớ");
      const fingerprint = cueFingerprint(c);
      store.db
        .prepare("INSERT OR REPLACE INTO approvals VALUES(?,?,?)")
        .run(e.id, id, fingerprint);
      const data = {
        ...c,
        scope,
        fingerprint,
        exactKey: memoryKey(e.cues, index, scope),
        order: orderOf(store, e),
        approvedAt: date,
      };
      store.db
        .prepare("INSERT OR REPLACE INTO translation_memory VALUES(?,?,?,?,?)")
        .run(hash([e.id, id]), e.seriesId, e.id, id, JSON.stringify(data));
    }
    store.db.exec("COMMIT");
  } catch (err) {
    store.db.exec("ROLLBACK");
    throw err;
  }
  return approvalState(store, e);
}
export function memories(store, e) {
  const episodes = new Map(store.episodes(e.seriesId).map((x) => [x.id, x]));
  return store.db
    .prepare("SELECT * FROM translation_memory WHERE series_id=?")
    .all(e.seriesId)
    .map((r) => ({
      ...JSON.parse(r.data),
      episodeId: r.episode_id,
      memoryId: r.id,
    }))
    .filter((m) => {
      const original = episodes.get(m.episodeId),
        cue = original?.cues.find((c) => c.id === m.id);
      return (
        cue &&
        cueFingerprint(cue) === m.fingerprint &&
        orderOf(store, original) <= orderOf(store, e)
      );
    });
}
export function reuseMemory(store, e, cues) {
  const approved = memories(store, e),
    scope = scopeKey(store, e);
  return cues.map((c, i) => {
    if (c.vi) return { ...c };
    const matches = approved.filter(
      (m) => m.scope === scope && m.exactKey === memoryKey(cues, i, scope),
    );
    const values = [...new Set(matches.map((m) => m.vi))];
    return values.length === 1 ? { ...c, vi: values[0] } : { ...c };
  });
}
function tokens(s) {
  const t = String(s).normalize("NFKC").toLowerCase();
  return [...t.matchAll(/[\p{L}\p{N}]+/gu)].flatMap((m) =>
    /\p{Script=Han}/u.test(m[0])
      ? [...m[0]].flatMap((c, i, a) =>
          i + 1 < a.length ? [c + a[i + 1]] : [c],
        )
      : [m[0]],
  );
}
export function retrieve(store, e, cues, limit = 6) {
  const k = getKnowledge(store, e.seriesId),
    order = orderOf(store, e);
  const docs = k.notes
    .filter((n) => n.episodeOrder === 0 || n.episodeOrder < order)
    .map((n, i) => ({
      source: `note:${i + 1}`,
      text: `${n.title}\n${n.content}`,
      order: n.episodeOrder,
    }));
  for (const m of memories(store, e))
    docs.push({
      source: `approved:${m.episodeId}:${m.id}`,
      text: `${m.text}\n${m.vi}`,
      speaker: m.speaker,
      listener: m.listener,
      order: m.order,
    });
  const query = new Set(
    tokens(
      cues
        .map((c) => `${c.text} ${c.speaker} ${c.listener} ${c.scene}`)
        .join(" "),
    ),
  );
  const bags = docs.map((d) => tokens(d.text)),
    avg = bags.reduce((n, b) => n + b.length, 0) / (bags.length || 1);
  const df = new Map();
  for (const bag of bags)
    for (const t of new Set(bag)) df.set(t, (df.get(t) || 0) + 1);
  return docs
    .map((d, i) => {
      const bag = bags[i];
      let score = 0;
      for (const t of query) {
        const tf = bag.filter((x) => x === t).length;
        if (tf)
          score +=
            (Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5)) *
              tf *
              2.2) /
            (tf + 1.2 * (0.25 + (0.75 * bag.length) / (avg || 1)));
      }
      if (
        d.speaker &&
        cues.some((c) => c.speaker === d.speaker && c.listener === d.listener)
      )
        score += 1;
      return { ...d, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...d }) => d);
}
export function contextFor(store, e, batch) {
  const k = getKnowledge(store, e.seriesId),
    source = batch.map((c) => c.text).join("\n");
  const relevant = k.characters.filter(
    (c) =>
      batch.some((q) => q.speaker === c.id || q.listener === c.id) ||
      [c.zh, ...c.aliases.split(",")].some(
        (a) => a.trim() && source.includes(a.trim()),
      ),
  );
  return {
    version: k.version,
    synopsis: k.synopsis.slice(0, 4000),
    terms: k.terms.filter((t) => source.includes(t.source)).slice(0, 40),
    characters: relevant.slice(0, 12),
    relations: k.relations.filter((r) =>
      batch.some((c) => c.speaker === r.from && c.listener === r.to),
    ),
    evidence: retrieve(store, e, batch),
  };
}

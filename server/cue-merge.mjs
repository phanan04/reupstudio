import { hash, validateCues } from "./core.mjs";

// Commit only results whose source snapshot is still current; retain appended cues,
// user edits, timestamps and IDs. SQLite operations here are synchronous/atomic.
export function mergeTranslations(store, id, before, after, checkpoint = {}) {
  const current = store.episode(id), originals = new Map(before.map(c => [c.id, c]));
  const results = new Map(after.map(c => [c.id, c]));
  const cues = current.cues.map(c => {
    const base = originals.get(c.id), result = results.get(c.id);
    return base && result && !c.vi?.trim() && hash(validateCues([base])[0]) === hash(validateCues([c])[0]) && result.vi
      ? { ...c, vi: result.vi } : c;
  });
  const changed = hash(cues) !== hash(current.cues);
  store.patch(id, { cues: validateCues(cues), revision: current.revision + Number(changed),
    translationCheckpoint: { ...checkpoint, done: cues.filter(c => c.vi?.trim()).length, total: cues.length, updated: new Date().toISOString() } });
  return cues;
}

export function editCuePatch(current, updates) {
  if (!Array.isArray(updates) || !updates.length || updates.length > 20000) throw Error("Danh sách sửa câu không hợp lệ");
  const map = new Map(updates.map(u => [u.id, u]));
  if (map.size !== updates.length) throw Error("ID cập nhật bị trùng");
  for (const [id, u] of map) {
    const cue = current.find(c => c.id === id);
    if (!cue || u.value?.id !== id || hash(cue) !== hash(u.base)) {
      const error = Error("Câu đã thay đổi trong khi chỉnh sửa. Bản đang nhập được giữ; tải lại câu để đối chiếu.");
      error.status = 409; throw error;
    }
  }
  return validateCues(current.map(c => map.get(c.id)?.value || c));
}

const KEY = 'eki-omukae.v1';

const defaults = () => ({
  dog: null,
  friends: [],   // 出会ったともだち（通算）
  gifts: [],     // 見たおみやげエンディング
  detours: [],
  wear: [],      // もらったきせかえ
  clears: 0,
  best: null,    // いちばん早く駅に着いた時刻（ゲーム内）
  settings: { sound: true, quality: 'auto' },
});

let data = defaults();

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const def = defaults();
      data = { ...def, ...d, settings: { ...def.settings, ...(d.settings || {}) } };
    } else {
      // 前の作品で作った「うちの子」を引き継ぐ
      for (const k of ['uchinoko-orusuban.v2', 'uchinoko-orusuban.v1']) {
        const old = localStorage.getItem(k);
        if (old) {
          const o = JSON.parse(old);
          if (o.dog) { data.dog = o.dog; break; }
        }
      }
    }
  } catch (e) {
    // 保存できない環境でも遊べる
  }
  return data;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* noop */ }
}
export function getSave() { return data; }

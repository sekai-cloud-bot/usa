const KEY = 'uchinoko-orusuban.v2';

const defaults = () => ({
  dog: null,
  album: {},          // 瞬間ごとのベスト { stars, score, thumb, at }
  best: { score: 0, total: 0 },
  plays: 0,
  settings: { sound: true, quality: 'auto' },
  tutorial: { done: false },
});

let data = defaults();

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const def = defaults();
      data = { ...def, ...d };
      data.best = { ...def.best, ...(d.best || {}) };
      data.settings = { ...def.settings, ...(d.settings || {}) };
      data.tutorial = { ...def.tutorial, ...(d.tutorial || {}) };
      data.album = d.album || {};
    } else {
      // 旧バージョンの「うちの子」設定だけ引き継ぐ
      const old = localStorage.getItem('uchinoko-orusuban.v1');
      if (old) {
        const o = JSON.parse(old);
        if (o.dog) data.dog = o.dog;
      }
    }
  } catch (e) {
    // 保存が使えない環境でも遊べるようにする
  }
  return data;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    // 容量オーバーなどは、サムネイルを落として再挑戦
    try {
      const slim = { ...data, album: Object.fromEntries(Object.entries(data.album).map(([k, v]) => [k, { ...v, thumb: null }])) };
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch (e2) { /* noop */ }
  }
}

export function getSave() { return data; }

const KEY = 'uchinoko-orusuban.v1';

const defaults = () => ({
  dog: null,
  best: { yen: 0, chain: 0 },
  incidents: {},
  plays: 0,
  lastOdai: null,
  settings: { sound: true, quality: 'auto' },
  tutorial: { grabbed: false, pulled: false, shaken: false, dashed: false },
});

let data = defaults();

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      data = { ...defaults(), ...d };
      data.best = { ...defaults().best, ...(d.best || {}) };
      data.settings = { ...defaults().settings, ...(d.settings || {}) };
      data.tutorial = { ...defaults().tutorial, ...(d.tutorial || {}) };
      data.incidents = d.incidents || {};
    }
  } catch (e) {
    // 保存が使えない環境でも遊べるようにする
  }
  return data;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) { /* noop */ }
}

export function getSave() { return data; }

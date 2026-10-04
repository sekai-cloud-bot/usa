// アクセス解析（Google アナリティクス）。index.html で gtag を用意した時だけ送る（手元で動かす時は 送らない）。
// 犬の名前など、入力した文字や 個人の情報は 送らない
export function track(name, params = {}) {
  try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch (e) { /* noop */ }
}

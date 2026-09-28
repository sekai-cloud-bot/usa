import { yen } from './util.js';
import { INCIDENT_MAP } from './incidents.js';

const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Kosugi Maru", "Yu Gothic", "Meiryo", "IPAGothic", sans-serif';
const INK = '#5b4033';
const CORAL = '#e8735f';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paw(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.2, s * 0.5, s * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  for (const [dx, dy] of [[-0.58, -0.28], [-0.22, -0.62], [0.22, -0.62], [0.58, -0.28]]) {
    ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, s * 0.21, 0, Math.PI * 2); ctx.fill();
  }
}

function loadImg(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

function wrapText(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      // 句読点は行頭に来ないように
      if ('、。！？…）」'.includes(ch)) { cur += ch; lines.push(cur); cur = ''; continue; }
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height, r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export async function makeShareCanvas(result, portraitURL) {
  try { await document.fonts?.ready; } catch (e) { /* noop */ }
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // 背景
  ctx.fillStyle = '#fbe3d8';
  ctx.fillRect(0, 0, W, H);
  rr(ctx, 22, 22, W - 44, H - 44, 48);
  ctx.fillStyle = '#fff6ec';
  ctx.fill();

  // タイトル
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  const title = `${result.name}のお留守番報告書`;
  let fs = 68;
  ctx.font = `800 ${fs}px ${FONT}`;
  while (ctx.measureText(title).width > 820 && fs > 40) { fs -= 2; ctx.font = `800 ${fs}px ${FONT}`; }
  ctx.fillText(title, W / 2, 104);
  const tw = ctx.measureText(title).width;
  paw(ctx, W / 2 - tw / 2 - 58, 108, 34, '#f3a08e');
  paw(ctx, W / 2 + tw / 2 + 58, 108, 34, '#f3a08e');

  // 写真
  const photo = await loadImg(result.photo);
  const px = 60, py = 170, pw = W - 120, ph = 600;
  ctx.save();
  rr(ctx, px, py, pw, ph, 36);
  ctx.clip();
  ctx.fillStyle = '#f1e1cf';
  ctx.fillRect(px, py, pw, ph);
  if (photo) drawCover(ctx, photo, px, py, pw, ph);
  ctx.restore();

  // 判定タグ
  ctx.save();
  ctx.translate(px + 40, py + 44);
  ctx.rotate(-0.06);
  ctx.font = `800 40px ${FONT}`;
  const vw = ctx.measureText(result.verdictLabel).width + 50;
  rr(ctx, -10, -34, vw, 68, 30);
  ctx.fillStyle = result.verdict === 'caught' || result.verdict === 'scene' ? CORAL : '#5aae8f';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.fillText(result.verdictLabel, 15, 2);
  ctx.restore();

  // 被害総額
  const lx = 70, ly = 820;
  ctx.textAlign = 'center';
  ctx.font = `800 38px ${FONT}`;
  const lab = '本日の被害総額';
  const lw = ctx.measureText(lab).width + 70;
  rr(ctx, lx + 290 - lw / 2, ly - 34, lw, 68, 34);
  ctx.fillStyle = '#fbd3c5';
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillText(lab, lx + 290, ly + 2);
  ctx.font = `800 118px ${FONT}`;
  let ys = yen(result.total);
  let yfs = 118;
  while (ctx.measureText(ys).width > 600 && yfs > 60) { yfs -= 4; ctx.font = `800 ${yfs}px ${FONT}`; }
  ctx.fillStyle = '#f7c6b5';
  ctx.fillRect(lx + 290 - ctx.measureText(ys).width / 2, ly + 138, ctx.measureText(ys).width, 16);
  ctx.fillStyle = INK;
  ctx.fillText(ys, lx + 290, ly + 100);

  // 明細
  const entries = Object.entries(result.ledger).filter(([, e]) => !e.bonus).sort((a, b) => b[1].yen - a[1].yen);
  const merged = {};
  for (const [k, e] of entries) {
    const lbl = { cushion: 'クッション', slipper: 'スリッパ', book: '本' }[k] || e.label;
    const m = merged[lbl] || (merged[lbl] = { key: k, label: lbl, count: 0, yen: 0 });
    m.count += e.count; m.yen += e.yen;
  }
  const list = Object.values(merged).sort((a, b) => b.yen - a.yen).slice(0, 4);
  const bx = 60, by = 1000, bw = 600, bh = 250;
  rr(ctx, bx, by, bw, bh, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.textBaseline = 'middle';
  if (list.length === 0) {
    ctx.fillStyle = INK;
    ctx.font = `800 36px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('被害なし。えらい！', bx + bw / 2, by + bh / 2);
  }
  list.forEach((e, i) => {
    const y = by + 44 + i * 56;
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText(e.label, bx + 34, y);
    const n = e.count > 0 ? (e.key === 'tissue' ? `${e.count}枚` : `×${e.count}`) : '';
    ctx.textAlign = 'right';
    ctx.font = `800 38px ${FONT}`;
    ctx.fillText(n, bx + bw - 34, y);
    ctx.strokeStyle = '#e6d3c2';
    ctx.setLineDash([3, 9]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.font = `800 34px ${FONT}`;
    const s0 = bx + 34 + ctx.measureText(e.label).width + 16;
    ctx.font = `800 38px ${FONT}`;
    const s1 = bx + bw - 34 - ctx.measureText(n).width - 16;
    ctx.moveTo(s0, y + 8); ctx.lineTo(s1, y + 8);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // 右側：顔と吹き出し
  const portrait = await loadImg(portraitURL);
  const cx = 860, cy = 900, cr = 150;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, cr, 0, Math.PI * 2);
  ctx.fillStyle = '#f6e6d6';
  ctx.fill();
  ctx.clip();
  if (portrait) drawCover(ctx, portrait, cx - cr, cy - cr, cr * 2, cr * 2);
  ctx.restore();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.stroke();

  // 吹き出し
  ctx.font = `800 30px ${FONT}`;
  const lines = wrapText(ctx, result.caption, 300).slice(0, 3);
  const qh = 40 + lines.length * 42;
  const qx = 690, qy = 1075, qw = 340;
  ctx.fillStyle = '#ffffff';
  rr(ctx, qx, qy, qw, qh, 28);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#f5b9a6';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 20, qy + 2); ctx.lineTo(cx, qy - 26); ctx.lineTo(cx + 20, qy + 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, qx + qw / 2, qy + 40 + i * 42));

  // 下部
  ctx.textAlign = 'center';
  ctx.font = `800 36px ${FONT}`;
  const foot = `反省：${result.hansei}%　かわいさ：`;
  const kw = `${result.kawaii}%`;
  const fw = ctx.measureText(foot).width, kww = ctx.measureText(kw).width;
  const fx = W / 2 - (fw + kww) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.fillText(foot, fx, 1286);
  ctx.fillStyle = '#ef6f8e';
  ctx.fillText(kw, fx + fw, 1286);
  paw(ctx, 90, 1290, 22, '#f5b9a6');
  paw(ctx, W - 90, 1290, 22, '#f5b9a6');

  // じけん（1つだけ）
  const hi = result.incidents.find((id) => result.newIncidents.includes(id)) || result.incidents[0];
  if (hi) {
    ctx.font = `800 28px ${FONT}`;
    const t = `じけん：${INCIDENT_MAP[hi].name}${result.maxChain >= 2 ? ` ・ 最大${result.maxChain}連鎖` : ''}`;
    const w = ctx.measureText(t).width + 40;
    rr(ctx, W - 60 - w, py + ph - 70, w, 50, 25);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(t, W - 60 - w / 2, py + ph - 44);
  }
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = '#b89a86';
  ctx.textAlign = 'right';
  ctx.fillText('#うちの子おるすばん', W - 60, 1244);
  return cv;
}

export function shareText(result) {
  return `${result.name}のお留守番報告書：被害総額${yen(result.total)}（${result.verdictLabel}）「${result.caption}」 #うちの子おるすばん`;
}

/** 共有（非対応ならプレビュー＋保存） */
export async function shareResult(result, portraitURL, ui, mode = 'share') {
  const cv = await makeShareCanvas(result, portraitURL);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const file = new File([blob], `orusuban-${Date.now()}.png`, { type: 'image/png' });
  const text = shareText(result);
  if (mode === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: 'お留守番報告書' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
    }
  }
  // プレビュー表示と保存
  const url = URL.createObjectURL(blob);
  const modal = document.getElementById('share-modal');
  document.getElementById('share-img').src = url;
  const dl = document.getElementById('share-dl');
  dl.href = url;
  dl.download = file.name;
  document.getElementById('share-note').textContent = mode === 'share'
    ? 'この環境では直接シェアできないため、画像を保存してから投稿してください（スマホは画像を長押し）'
    : '画像を保存できます（スマホは画像を長押し）';
  modal.classList.remove('hidden');
  if (mode === 'save') {
    try { dl.click(); } catch (e) { /* noop */ }
  }
  return 'preview';
}

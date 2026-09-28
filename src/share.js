import { yen } from './util.js';

const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Kosugi Maru", "Yu Gothic", "Meiryo", "IPAGothic", sans-serif';
const INK = '#5b4033';

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

function stars(ctx, n, x, y, size) {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = 'left';
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < n ? '#f6be3c' : '#eadfd2';
    ctx.fillText('★', x + i * size * 1.02, y);
  }
}

/** 「みまもり日記」画像 */
export async function makeShareCanvas(result, photo, portraitURL, albumCount) {
  try { await document.fonts?.ready; } catch (e) { /* noop */ }
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fbe3d8';
  ctx.fillRect(0, 0, W, H);
  rr(ctx, 22, 22, W - 44, H - 44, 48);
  ctx.fillStyle = '#fff6ec';
  ctx.fill();

  // タイトル
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  const title = `${result.name}のみまもり日記`;
  let fs = 64;
  ctx.font = `800 ${fs}px ${FONT}`;
  while (ctx.measureText(title).width > 800 && fs > 40) { fs -= 2; ctx.font = `800 ${fs}px ${FONT}`; }
  ctx.fillText(title, W / 2, 100);
  const tw = ctx.measureText(title).width;
  paw(ctx, W / 2 - tw / 2 - 56, 104, 32, '#f3a08e');
  paw(ctx, W / 2 + tw / 2 + 56, 104, 32, '#f3a08e');

  // ポラロイド
  const img = await loadImg(photo && photo.url);
  ctx.save();
  ctx.translate(W / 2, 580);
  ctx.rotate(-0.025);
  const pw = 880, ph = 660, pad = 22, bottom = 130;
  ctx.shadowColor = 'rgba(90, 50, 20, 0.25)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-pw / 2 - pad, -ph / 2 - pad, pw + pad * 2, ph + pad + bottom);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#eee';
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  if (img) drawCover(ctx, img, -pw / 2, -ph / 2, pw, ph);
  // カメラの表示
  ctx.textAlign = 'left';
  ctx.font = `800 28px ${FONT}`;
  rr(ctx, -pw / 2 + 18, -ph / 2 + 18, 230, 48, 20);
  ctx.fillStyle = 'rgba(34, 24, 20, 0.5)';
  ctx.fill();
  ctx.fillStyle = '#ff4b5c';
  ctx.beginPath(); ctx.arc(-pw / 2 + 44, -ph / 2 + 42, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(`LIVE  ${photo ? photo.time : ''}`, -pw / 2 + 62, -ph / 2 + 43);
  // 名前と★
  ctx.fillStyle = INK;
  ctx.font = `800 50px ${FONT}`;
  const name = photo ? photo.name : '写真なし';
  ctx.fillText(name, -pw / 2, ph / 2 + 70);
  const nw = ctx.measureText(name).width;
  if (photo && photo.stars) stars(ctx, photo.stars, -pw / 2 + nw + 26, ph / 2 + 70, 48);
  ctx.textAlign = 'right';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillStyle = '#b89a86';
  ctx.fillText(photo ? `${photo.score}pt` : '', pw / 2, ph / 2 + 72);
  ctx.restore();

  // 顔と吹き出し
  const portrait = await loadImg(portraitURL);
  const cx = 190, cy = 1135, cr = 105;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, cr, 0, Math.PI * 2);
  ctx.fillStyle = '#f6e6d6';
  ctx.fill();
  ctx.clip();
  if (portrait) drawCover(ctx, portrait, cx - cr, cy - cr, cr * 2, cr * 2);
  ctx.restore();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.stroke();

  const cap = photo ? `「${photo.caption}」` : '「今日はずっとねてました」';
  ctx.font = `800 38px ${FONT}`;
  const lines = wrapText(ctx, cap, 620).slice(0, 2);
  const bx = 330, by = 1062, bw = 690, bh = 60 + lines.length * 50;
  rr(ctx, bx, by, bw, bh, 30);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#f5b9a6';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx + 2, by + 50); ctx.lineTo(bx - 28, by + 70); ctx.lineTo(bx + 2, by + 90);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, bx + 34, by + 55 + i * 50));

  // 下部
  ctx.textAlign = 'center';
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = INK;
  const meta = `本日の被害 ${yen(result.damage)} ・ アルバム ${albumCount}`;
  ctx.fillText(meta, W / 2, 1262);
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = '#b89a86';
  ctx.fillText('#うちの子おるすばん', W / 2, 1300);
  paw(ctx, 90, 1280, 22, '#f5b9a6');
  paw(ctx, W - 90, 1280, 22, '#f5b9a6');
  return cv;
}

export function shareText(result, photo) {
  const p = photo ? `「${photo.name}」${'★'.repeat(photo.stars)}` : '';
  return `昼休みにみまもりカメラをのぞいたら、${result.name}の${p}が撮れました。 #うちの子おるすばん`;
}

/** 共有（非対応ならプレビュー＋保存） */
export async function shareResult(result, photo, portraitURL, albumCount, mode = 'share') {
  const cv = await makeShareCanvas(result, photo, portraitURL, albumCount);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const file = new File([blob], `uchinoko-${Date.now()}.png`, { type: 'image/png' });
  const text = shareText(result, photo);
  if (mode === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: 'みまもり日記' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
    }
  }
  const url = URL.createObjectURL(blob);
  document.getElementById('share-img').src = url;
  const dl = document.getElementById('share-dl');
  dl.href = url;
  dl.download = file.name;
  document.getElementById('share-note').textContent = mode === 'share'
    ? 'この環境では直接シェアできないため、画像を保存してから投稿してください（スマホは画像を長押し）'
    : '画像を保存できます（スマホは画像を長押し）';
  document.getElementById('share-modal').classList.remove('hidden');
  if (mode === 'save') {
    try { dl.click(); } catch (e) { /* noop */ }
  }
  return 'preview';
}

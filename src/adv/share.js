import { FRIENDS, GIFTS, DETOURS } from './game.js';

const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
const DISPLAY = '"Kiwi Maru", "Hiragino Mincho ProN", "Yu Mincho", serif';
const INK = '#4a3428';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
function cover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height, r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; } else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
export const fmtHour = (h) => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${hh}:${String(mm).padStart(2, '0')}`; };

/** 「おむかえ日記」1080×1350 */
export async function makeDiaryCanvas(r) {
  try { await document.fonts?.ready; } catch (e) { /* noop */ }
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // 夕焼けの紙
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#f6c9a0');
  bg.addColorStop(1, '#e8a6a0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  rr(ctx, 30, 30, W - 60, H - 60, 44);
  ctx.fillStyle = '#fffaf2';
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8744f';
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText('お む か え 日 記', W / 2, 96);
  ctx.fillStyle = INK;
  let fs = 60;
  const title = `${r.name}、駅までおむかえに行けました`;
  ctx.font = `500 ${fs}px ${DISPLAY}`;
  while (ctx.measureText(title).width > 940 && fs > 36) { fs -= 2; ctx.font = `500 ${fs}px ${DISPLAY}`; }
  ctx.fillText(title, W / 2, 168);

  // 写真
  const img = await loadImg(r.photo);
  const px = 80, py = 230, pw = W - 160, ph = 660;
  ctx.save();
  ctx.shadowColor = 'rgba(80, 40, 20, .28)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#fff';
  rr(ctx, px - 16, py - 16, pw + 32, ph + 32, 22);
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, px, py, pw, ph, 12);
  ctx.clip();
  ctx.fillStyle = '#e9d8c4';
  ctx.fillRect(px, py, pw, ph);
  if (img) cover(ctx, img, px, py, pw, ph);
  const vg = ctx.createLinearGradient(0, py + ph - 140, 0, py + ph);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(40,16,8,.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(`18:00  ひだまり駅`, px + pw - 24, py + ph - 34);

  // 3つの数字
  const cells = [
    ['おみやげ', GIFTS[r.gift].label],
    ['ともだち', `${r.friends.length} / ${FRIENDS.length}`],
    ['到着', fmtHour(r.arrive)],
  ];
  const cw = (W - 160 - 40) / 3;
  cells.forEach(([k, v], i) => {
    const x = 80 + i * (cw + 20), y = 935;
    rr(ctx, x, y, cw, 118, 22);
    ctx.fillStyle = '#f8eee2';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8a6a58';
    ctx.font = `800 24px ${FONT}`;
    ctx.fillText(k, x + cw / 2, y + 36);
    ctx.fillStyle = INK;
    let f2 = 40;
    ctx.font = `800 ${f2}px ${FONT}`;
    while (ctx.measureText(v).width > cw - 24 && f2 > 22) { f2 -= 2; ctx.font = `800 ${f2}px ${FONT}`; }
    ctx.fillText(v, x + cw / 2, y + 80);
  });

  // ともだちのしるし
  const fy = 1110;
  const n = FRIENDS.length;
  const gap = (W - 200) / (n - 1);
  FRIENDS.forEach((f, i) => {
    const x = 100 + i * gap;
    const met = r.friends.includes(f.id);
    ctx.beginPath();
    ctx.arc(x, fy, 30, 0, Math.PI * 2);
    ctx.fillStyle = met ? f.color : '#eee3d6';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = met ? '#f6c86a' : '#fff';
    ctx.stroke();
    ctx.fillStyle = met ? '#fff' : '#cbb8a4';
    ctx.font = `800 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(met ? f.name.replace(/^.*の/, '').slice(0, 1) : '?', x, fy + 2);
  });
  // 寄り道
  ctx.fillStyle = '#b0603a';
  ctx.font = `800 26px ${FONT}`;
  const det = r.detours.map((d) => DETOURS[d]).slice(0, 3).join('・');
  ctx.fillText(det ? `寄り道：${det}` : GIFTS[r.gift].stamp, W / 2, 1190);
  ctx.fillStyle = '#b89a86';
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText('#駅までおむかえ', W / 2, 1262);
  return cv;
}

export function diaryText(r) {
  return `${r.name}が ひとりで駅までおむかえに来てくれました。おみやげは「${GIFTS[r.gift].label}」、ともだち${r.friends.length}人。 #駅までおむかえ`;
}

export async function shareDiary(r, mode = 'share') {
  const cv = await makeDiaryCanvas(r);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const file = new File([blob], `omukae-${Date.now()}.png`, { type: 'image/png' });
  if (mode === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: diaryText(r), title: 'おむかえ日記' });
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
    ? 'この環境では直接シェアできないので、画像を保存してから投稿してください（スマホは画像を長押し）。'
    : '画像を保存できます（スマホは画像を長押し）。';
  document.getElementById('share-modal').classList.remove('hidden');
  if (mode === 'save') { try { dl.click(); } catch (e) { /* noop */ } }
  return 'preview';
}

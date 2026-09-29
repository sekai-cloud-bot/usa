import { GIFTS, EVENTS } from './game.js';

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
function fitText(ctx, text, maxW, size, weight, family) {
  let fs = size;
  ctx.font = `${weight} ${fs}px ${family}`;
  while (ctx.measureText(text).width > maxW && fs > 14) { fs -= 2; ctx.font = `${weight} ${fs}px ${family}`; }
}
export const fmtHour = (h) => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${hh}:${String(mm).padStart(2, '0')}`; };

/** 「おむかえ日記」1080×1350：再会の写真と、寄り道の思い出3枚 */
export async function makeDiaryCanvas(r) {
  try { await document.fonts?.ready; } catch (e) { /* noop */ }
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // 夕焼けの紙
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#f6c9a0');
  bg.addColorStop(1, '#d99aa6');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  rr(ctx, 30, 30, W - 60, H - 60, 44);
  ctx.fillStyle = '#fffaf2';
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8744f';
  ctx.font = `800 28px ${FONT}`;
  ctx.fillText('お む か え 日 記', W / 2, 88);
  ctx.fillStyle = INK;
  const title = r.late ? `${r.name}、駅まで さがしに来てくれました` : `${r.name}、駅までおむかえに行けました`;
  fitText(ctx, title, 940, 54, 500, DISPLAY);
  ctx.fillText(title, W / 2, 150);

  // 再会の写真
  const img = await loadImg(r.photo);
  const px = 80, py = 205, pw = W - 160, ph = 520;
  ctx.save();
  ctx.shadowColor = 'rgba(80, 40, 20, .28)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#fff';
  rr(ctx, px - 14, py - 14, pw + 28, ph + 28, 22);
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
  ctx.font = `800 32px ${FONT}`;
  ctx.fillText(`${fmtHour(r.arrive)}  ひだまり駅`, px + pw - 24, py + ph - 32);

  // 思い出（3枚）
  const mem = (r.memories || []).filter((m) => m.url);
  const pick = [];
  for (const k of ['view', 'friend', 'play', 'item']) { const m = mem.find((x) => x.kind === k && !pick.includes(x)); if (m && pick.length < 3) pick.push(m); }
  for (const m of mem) if (pick.length < 3 && !pick.includes(m)) pick.push(m);
  const aw = 290, ah = 181, gap = (W - 160 - aw * 3) / 2;
  for (let i = 0; i < pick.length; i++) {
    const m = pick[i];
    const x = 80 + i * (aw + gap), y = 780;
    const rot = (i - 1) * 0.035;
    const im = await loadImg(m.url);
    ctx.save();
    ctx.translate(x + aw / 2, y + ah / 2 + 20);
    ctx.rotate(rot);
    ctx.shadowColor = 'rgba(80, 40, 20, .25)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fff';
    ctx.fillRect(-aw / 2 - 10, -ah / 2 - 10, aw + 20, ah + 64);
    ctx.shadowColor = 'transparent';
    if (im) cover(ctx, im, -aw / 2, -ah / 2, aw, ah);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    fitText(ctx, m.title, aw - 10, 24, 800, FONT);
    ctx.fillText(m.title, 0, ah / 2 + 28);
    ctx.restore();
  }

  // 3つの数字
  const cells = [
    ['おみやげ', GIFTS[r.gift].label],
    ['できごと', `${r.events.length} / ${EVENTS.length}`],
    ['到着', fmtHour(r.arrive)],
  ];
  const cw = (W - 160 - 40) / 3;
  cells.forEach(([k, v], i) => {
    const x = 80 + i * (cw + 20), y = pick.length ? 1070 : 790;
    rr(ctx, x, y, cw, 110, 22);
    ctx.fillStyle = '#f8eee2';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8a6a58';
    ctx.font = `800 23px ${FONT}`;
    ctx.fillText(k, x + cw / 2, y + 34);
    ctx.fillStyle = INK;
    fitText(ctx, v, cw - 24, 38, 800, FONT);
    ctx.fillText(v, x + cw / 2, y + 76);
  });
  // 写真がない日は、日記の一言で余白をうめる
  if (!pick.length) {
    const lines = [
      r.late ? 'ちょっと おくれて、駅まで さがしに行きました。' : 'きょうは まっすぐ、駅まで 走りました。',
      '町には まだ 見ていない できごとが いっぱい。',
      'つぎは どこに 寄り道しようかな。',
    ];
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    lines.forEach((l, i) => {
      fitText(ctx, l, 900, 38, 500, DISPLAY);
      ctx.fillText(l, W / 2, 1000 + i * 66);
    });
    ctx.strokeStyle = '#ecdccb';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(130, 1030 + i * 66);
      ctx.lineTo(W - 130, 1030 + i * 66);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#b0603a';
  ctx.textAlign = 'center';
  const foot = r.fortune ? `おみくじ 大吉：${r.fortune}` : `ともだち ${r.friends.length}人と 出会った夕方`;
  fitText(ctx, foot, 900, 26, 800, FONT);
  ctx.fillText(foot, W / 2, pick.length ? 1225 : 1210);
  ctx.fillStyle = '#b89a86';
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText('#駅までおむかえ', W / 2, 1275);
  return cv;
}

export function diaryText(r) {
  return `${r.name}が ひとりで駅までおむかえに来てくれました。おみやげは「${GIFTS[r.gift].label}」、できごと${r.events.length}こ。 #駅までおむかえ`;
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

// 撮れる「瞬間」の一覧（アルバム）。face: 顔が写っていないと評価が大きく下がる
export const MOMENTS = [
  { id: 'tissue', name: 'ティッシュ大行進', base: 300, hint: 'ティッシュをくわえて走っているところ', caption: 'ティッシュ、どこまでのびる？' },
  { id: 'playbow', name: 'うずうずポーズ', base: 260, hint: 'いたずらの直前、おしりを上げたら要注意', caption: 'いまから何かが起きます。' },
  { id: 'shake', name: 'ぶんぶん', base: 260, hint: 'くわえた物をぶんぶん振っているところ', caption: 'ぶんぶんぶん。' },
  { id: 'fluff', name: 'クッション雪まつり', base: 520, hint: 'クッションが破裂した瞬間', caption: '雪じゃないです。綿です。' },
  { id: 'topple', name: 'ガシャーン', base: 320, hint: '何かが倒れている途中', caption: '……あっ。' },
  { id: 'mug', name: 'マグカップの最期', base: 460, hint: 'マグカップが宙を舞う瞬間（テーブルに注意）', caption: 'さよなら、マグカップ。' },
  { id: 'domino', name: '段ボールドミノ', base: 560, hint: '段ボールが次々に倒れていくところ', caption: 'ドミノ大会、開催中。' },
  { id: 'slipper', name: 'スリッパ泥棒', base: 260, hint: 'スリッパをくわえて運んでいるところ', caption: 'スリッパ、お借りします。' },
  { id: 'treasure', name: 'お宝コレクション', base: 420, hint: '自分のベッドに集めたお宝と一緒に', caption: 'ぜんぶ、ぼくの。' },
  { id: 'treat', name: 'おやつキャッチ', base: 420, hint: 'すぐ近くにおやつを投げると、空中で…', caption: 'ナイスキャッチ！' },
  { id: 'camme', name: 'カメラ目線', base: 220, face: true, hint: 'ときどき、こっちをじっと見てくる', caption: '見てるの、知ってるよ。' },
  { id: 'tilt', name: '首かしげ', base: 320, face: true, hint: '【よぶ】で名前を呼ぶと…', caption: 'よんだ？' },
  { id: 'innocent', name: '無実の顔', base: 800, face: true, hint: 'いたずらの直後に名前を呼ぶと…（散らかりも一緒に写すと高評価）', caption: 'なんのことですか？' },
  { id: 'caught', name: '現行犯', base: 620, face: true, hint: '何かをくわえているときに名前を呼ぶと…', caption: '……これは、ちがうんです。' },
  { id: 'ignore', name: '聞こえないふり', base: 420, hint: '名前を何度も呼びすぎると…', caption: '（聞こえないふり）' },
  { id: 'zoomies', name: 'ズーミー', base: 360, hint: 'テンションが上がると走り回る', caption: '止まりません。' },
  { id: 'nap', name: 'すやすや', base: 220, hint: 'おひるね中', caption: 'すやすや。' },
  { id: 'belly', name: 'へそ天', base: 520, hint: '日だまりでおひるねしていると…', caption: '無防備にもほどがある。' },
  { id: 'yawn', name: '大あくび', base: 460, hint: '眠くなってくると…（一瞬なのでタイミングが大事）', caption: 'ふぁ〜〜。' },
  { id: 'window', name: '窓辺の背中', base: 320, back: true, hint: '窓の外をながめている後ろ姿', caption: '何を見てるの？' },
  { id: 'laser', name: 'レーザーハンター', base: 320, hint: '【レーザー】を追いかけているところ', caption: 'つかまえた！（つかまえてない）' },
  { id: 'trash', name: 'ゴミ箱探検', base: 320, hint: 'ゴミ箱を倒したあとは…', caption: '調査中です。' },
  { id: 'bark', name: 'ピンポン番犬', base: 360, hint: 'インターホンが鳴ったら…', caption: 'わん！わん！（配達です）' },
  { id: 'ball', name: 'ボールあそび', base: 260, hint: 'ボールを追いかけているところ', caption: 'ボールは友だち。' },
];

export const MOMENT_MAP = Object.fromEntries(MOMENTS.map((m) => [m.id, m]));
export const PLAIN = { id: 'plain', name: 'うちの子', base: 100, hint: '', caption: 'きょうもかわいい。' };

export const PERSONALITIES = [
  { id: 'yancha', label: 'やんちゃ', desc: 'いたずら・ズーミー多め', mischief: 1.5, sleep: 0.8, food: 1.0, amae: 0.9, zoom: 1.5 },
  { id: 'kuishinbo', label: 'くいしんぼう', desc: 'おやつとゴミ箱に弱い', mischief: 1.0, sleep: 1.0, food: 1.7, amae: 1.0, zoom: 1.0 },
  { id: 'nebosuke', label: 'ねぼすけ', desc: 'よく寝る・へそ天しがち', mischief: 0.8, sleep: 1.8, food: 1.0, amae: 1.0, zoom: 0.7 },
  { id: 'amaenbo', label: 'あまえんぼう', desc: 'カメラをよく見る・呼ぶと来る', mischief: 1.0, sleep: 1.0, food: 1.0, amae: 1.8, zoom: 1.0 },
];
export const PERSONALITY_MAP = Object.fromEntries(PERSONALITIES.map((p) => [p.id, p]));

export function starsFor(ratio) {
  if (ratio >= 0.78) return 3;
  if (ratio >= 0.5) return 2;
  return 1;
}

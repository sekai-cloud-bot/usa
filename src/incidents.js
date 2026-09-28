// じけん図鑑。odai は「今日のお題」としての言い回し
export const INCIDENTS = [
  { id: 'tissue10', name: 'ティッシュ大行進', odai: 'ティッシュ、どこまでのびる？', hint: 'ティッシュをくわえて、そのまま遠くまで走る', bonus: 800 },
  { id: 'tissueEmpty', name: 'からっぽの箱', odai: 'ティッシュ箱をからっぽに', hint: 'ティッシュを最後の1枚まで引き出す', bonus: 1500 },
  { id: 'wrap', name: 'ぐるぐる巻き', odai: 'テーブルをティッシュで一周', hint: 'ティッシュをくわえたまま、テーブルのまわりを一周', bonus: 2000 },
  { id: 'fluff', name: 'クッション雪まつり', odai: 'クッションを雪まつりに', hint: 'クッションをくわえて【長押し】でぶんぶん', bonus: 1500 },
  { id: 'throwHit', name: 'ナイスシュート', odai: '投げて何かを倒す', hint: 'ぶんぶん中にボタンをはなすと投げる。狙いをつけて！', bonus: 1500 },
  { id: 'slipperMove', name: 'スリッパのお引っ越し', odai: 'スリッパ2つをベッドへ', hint: '玄関のスリッパを、自分のベッドまで運ぶ', bonus: 1500 },
  { id: 'chew', name: '穴あきスリッパ', odai: 'スリッパをかみかみ', hint: 'スリッパをくわえて【長押し】でかみかみ', bonus: 800 },
  { id: 'ballAvalanche', name: 'ボール雪崩', odai: 'おもちゃカゴをひっくり返す', hint: 'おもちゃカゴに【はしる】で体当たり', bonus: 800 },
  { id: 'plantByBall', name: '観葉植物の悲劇', odai: 'ボールで植木鉢を倒す', hint: '転がるボールが植木鉢に当たると…', bonus: 2000 },
  { id: 'mug', name: 'マグカップの最期', odai: 'テーブルのマグカップを落とす', hint: 'テーブルに【はしる】で体当たり', bonus: 1000 },
  { id: 'domino', name: '段ボールドミノ', odai: '段ボールを全部たおす', hint: '並んだ段ボールの端を押すと…', bonus: 2000 },
  { id: 'lamp', name: 'ライトの巻き添え', odai: '倒れたライトで何かを倒す', hint: 'スタンドライトの倒れる先には…', bonus: 2500 },
  { id: 'chain3', name: '3連鎖', odai: '3連鎖をねらえ', hint: '2秒以内に次々といたずらを起こす', bonus: 1000 },
  { id: 'chain6', name: '6連鎖の大惨事', odai: '6連鎖をねらえ', hint: 'ドミノ、ボール、ライト… 仕掛けをつなげて', bonus: 3000 },
  { id: 'trash', name: 'ゴミ箱探検', odai: 'ゴミ箱の中をしらべる', hint: 'ゴミ箱にぶつかると…', bonus: 600 },
  { id: 'nap', name: 'ひなたぼっこ', odai: '日だまりでおひるね', hint: '日だまりや自分のベッドで、しばらく何もしない', bonus: 300 },
  { id: 'innocent', name: '完全犯罪', odai: '¥10,000以上やって、しらんぷり', hint: '被害¥10,000以上で、帰宅の瞬間ベッドで何もくわえていない', bonus: 3000 },
  { id: 'caught', name: '現行犯', odai: 'くわえたまま「おかえり」', hint: '帰宅の瞬間、何かをくわえている', bonus: 500 },
  { id: 'goodboy', name: 'ほんとうにいい子', odai: '何もせずに待つ', hint: '一度もいたずらせずに帰宅をむかえる', bonus: 0 },
  { id: 'big30k', name: '被害総額3万円', odai: '被害総額¥30,000こえ', hint: '連鎖ボーナスで一気に稼ぐ', bonus: 0 },
];

export const INCIDENT_MAP = Object.fromEntries(INCIDENTS.map((i) => [i.id, i]));

// 最初のうちは易しいお題から
const EASY_ORDER = ['tissue10', 'fluff', 'ballAvalanche', 'slipperMove', 'mug', 'chain3', 'domino', 'wrap', 'chew', 'throwHit', 'trash', 'plantByBall', 'lamp', 'tissueEmpty', 'innocent', 'nap', 'caught', 'chain6', 'big30k'];

export function chooseOdai(found, last) {
  const notFound = EASY_ORDER.filter((id) => !found[id] && id !== last);
  if (notFound.length) return notFound[0];
  const pool = EASY_ORDER.filter((id) => id !== last && id !== 'goodboy');
  return pool[Math.floor(Math.random() * pool.length)];
}

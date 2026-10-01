// ------------------------------------------------------------
// きょうの称号：その日の おむかえの しかたで もらえる。
// 上にあるほど めずらしい。はじめて もらった物を優先して見せる
// ------------------------------------------------------------
const has = (r, ...ids) => ids.every((id) => r.events.includes(id));

export const TITLES = [
  { id: 'master', name: 'ひだまり町の 名探偵', sub: 'その日のうちに、できごとを ぜんぶ', test: (r) => r.events.length >= r.totalEventCount },
  { id: 'golden', name: '伝説の 金のほね', sub: '拝殿の うらで、金のほねを ほりあてた', test: (r) => r.treasureNew.includes('gold') },
  { id: 'parade', name: 'おむかえ 大行列', sub: 'なかま 3びきと いっしょに 駅へ', test: (r) => r.party.length >= 3 },
  { id: 'freeze', name: 'ピタッと名人', sub: 'だるまさんが ころんだ で、いちども うごかずに勝った', test: (r) => r.darumaPerfect },
  { id: 'hunter', name: 'トレジャーハンター', sub: 'いちどの おむかえで、5か所 ほった', test: (r) => r.dug >= 5 },
  { id: 'many', name: '寄り道の天才', sub: 'できごと 15こ以上', test: (r) => r.events.length >= 15 },
  { id: 'popular', name: '町の 人気者', sub: 'ともだち 8人以上と 出会った', test: (r) => r.friends.length >= 8 },
  { id: 'singer', name: '町の うたうたい', sub: 'ハーモニカ・ギター・5時のチャイムで うたった', test: (r) => has(r, 'harmonica', 'musician', 'chime') },
  { id: 'foodie', name: 'くいしんぼう', sub: 'にぼし・コロッケ・焼きいもを ぜんぶ', test: (r) => has(r, 'grandma', 'butcher', 'yakiimo') },
  { id: 'catfriend', name: 'ねこの なかま', sub: 'ミケとも、ねこの集会とも なかよし', test: (r) => has(r, 'cat', 'cats') },
  { id: 'savior', name: 'カルガモの 恩人', sub: 'まいごの ひなを、お母さんの所へ', test: (r) => has(r, 'duckling') },
  { id: 'wet', name: 'ずぶぬれ探検家', sub: 'ぬれたまま、おむかえ', test: (r) => r.wet },
  { id: 'dash', name: 'まっしぐら', sub: '17時より前に、駅に着いた', test: (r) => !r.late && r.arrive < 17.0 },
  { id: 'together', name: 'なかまと いっしょ', sub: 'なかまと 駅まで来た', test: (r) => r.party.length >= 1 },
  { id: 'mypace', name: 'マイペース', sub: 'ちょっと おくれて、さがしに来た', test: (r) => r.late },
  { id: 'plain', name: 'おむかえ犬', sub: 'きょうも ちゃんと、おむかえ', test: () => true },
];

/**
 * きょうの称号を決めて、もらった称号を保存データに足す。
 * r: 結果（game.finish の result）、saved: 前から持っている称号の id
 * 戻り値：{ title（見せる称号）, isNew, more（ほかに はじめて もらった数）, earned（ぜんぶの id） }
 */
export function pickTitle(r, saved = []) {
  const ok = TITLES.filter((t) => { try { return t.test(r); } catch (e) { return false; } });
  const fresh = ok.filter((t) => !saved.includes(t.id));
  const title = fresh[0] || ok[0];
  const earned = [...new Set([...saved, ...ok.map((t) => t.id)])];
  return { title, isNew: fresh.length > 0, more: Math.max(0, fresh.length - 1), earned };
}

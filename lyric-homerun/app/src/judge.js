// 判定(純関数)。スイング時刻 − 到達時刻 = ずれ(ms)。負は早い、正は遅い。
//   big   … 特大ホームラン
//   hr    … ホームラン
//   hit   … ヒット(ノルマに数えない)
//   whiff … 空振り(球は消費する)
//   look  … 見逃し(振らなかった。game 側が到達 +hit で確定する)
// 見逃しの確定を遅らせない: hit 窓を過ぎたらすぐ確定(ontology: miss-declared-too-late)。

export const WIN = { big: 45, hr: 90, hit: 150, whiff: 350 };

/** @returns {"big"|"hr"|"hit"|"whiff"|null} null = この球に対するスイングではない(素振り) */
export function judge(dt, reach = WIN.whiff) {
  const a = Math.abs(dt);
  if (a > Math.min(WIN.whiff, reach)) return null;
  if (a <= WIN.big) return "big";
  if (a <= WIN.hr) return "hr";
  if (a <= WIN.hit) return "hit";
  return "whiff";
}

export function isHomerun(res) {
  return res === "big" || res === "hr";
}

/** 打球の方向。-1 = 左(早い=引っ張り) … +1 = 右(遅い=流し)。 */
export function direction(dt) {
  return Math.max(-1, Math.min(1, dt / WIN.hr));
}

/**
 * スイング時刻 t に対応する球を選ぶ。まだ結果の無い球のうち、いちばん近いもの。
 * 届く範囲は「隣の球との中間点」で切る(ontology: char-interval-can-be-51ms)。
 * @returns {number} 球の番号。対応する球が無ければ -1
 */
export function pickPitch(pitches, results, t) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < pitches.length; i++) {
    const d = Math.abs(t - pitches[i].t);
    if (pitches[i].t - t > WIN.whiff) break;
    if (results[i] || d > reachOf(pitches, i)) continue;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function reachOf(pitches, i) {
  let r = WIN.whiff;
  if (i > 0) r = Math.min(r, (pitches[i].t - pitches[i - 1].t) / 2);
  if (i < pitches.length - 1) r = Math.min(r, (pitches[i + 1].t - pitches[i].t) / 2);
  return r;
}

/** 成績の集計。 */
export function tally(pitches, results) {
  const n = { big: 0, hr: 0, hit: 0, whiff: 0, look: 0 };
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < pitches.length; i++) {
    const r = results[i];
    if (!r) continue;
    n[r.res]++;
    if (r.res !== "look") {
      sum += r.dt;
      cnt++;
    }
  }
  return { ...n, homeruns: n.big + n.hr, thrown: n.big + n.hr + n.hit + n.whiff + n.look, bias: cnt ? sum / cnt : 0 };
}

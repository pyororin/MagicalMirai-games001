// 投球生成(純関数)。楽曲データ → 投球列。
//   到達時刻 … 歌詞の文字の発声開始。「歌われる瞬間にホームへ届く」
//   選び方   … フレーズ頭 > 拍の上 > 語頭 の順に価値を付け、最小間隔を守って拾う
//              (ontology: gap-only-thinning-kills-anticipation)
//   最小間隔 … 実時間で決めて拍の整数倍に丸める。拍数固定だと曲のテンポで密度が倍違う
//              (docs/DESIGN.md §4。2025年課題曲6曲で実測)
// 乱数は使わない。同じ曲・同じ難易度なら毎回同じ投球になる。

/** 楽曲データ(JSON のコンパクト形式)を扱いやすい形に展開する。 */
export function expandSong(raw) {
  return {
    code: raw.code,
    title: raw.title,
    artist: raw.artist,
    url: raw.url,
    beats: raw.beats.map((b) => ({ t: b[0], pos: b[1], len: b[2] })),
    chords: raw.chords.map((c) => ({ s: c[0], e: c[1], name: c[2] })),
    phrases: raw.phrases.map((p) => ({
      s: p.s,
      e: p.e,
      chars: p.chars.map((c) => ({ text: c[0], s: c[2], e: c[3], w: !!c[4] })),
    })),
  };
}

/** minGap = 最小間隔(ms)。minScore = 拾う価値の下限。quota = ノルマ(ホームラン率)。 */
export const DIFFS = {
  EASY: { minGap: 1800, minScore: 100, quota: 0.3 },
  NORMAL: { minGap: 1200, minScore: 30, quota: 0.5 },
  HARD: { minGap: 800, minScore: 10, quota: 0.7 },
};

const SCORE_PHRASE_HEAD = 100;
const SCORE_ON_BEAT = 30;
const SCORE_WORD_HEAD = 10;
const ON_BEAT_TOL = 70;
const FLIGHT_TARGET = 900;
const NOT_A_SYLLABLE = /^[\s、。，．,.!?！？「」『』（）()・…‥ー〜~\-―♪]*$/;

/** 拍の平均間隔(ms)。拍が無ければ 0。 */
export function beatMs(beats) {
  if (!beats || beats.length < 2) return 0;
  return (beats[beats.length - 1].t - beats[0].t) / (beats.length - 1);
}

/** 時刻 t にいちばん近い拍までの距離(ms)。 */
function distToBeat(times, t) {
  if (!times.length) return Infinity;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (times[m] <= t) lo = m;
    else hi = m;
  }
  return Math.min(Math.abs(t - times[lo]), Math.abs(t - times[hi]));
}

/** 飛行時間(ms)。約0.9秒を拍の整数倍に丸める。 */
export function flightMs(bm) {
  if (!(bm > 0)) return FLIGHT_TARGET;
  const f = Math.max(1, Math.round(FLIGHT_TARGET / bm)) * bm;
  return Math.min(1300, Math.max(600, f));
}

/**
 * @returns {{pitches: Array<{idx:number,t:number,pi:number,ci:number,chars:Array<{text:string,s:number}>}>,
 *            flight:number, quota:number, beatMs:number}}
 *   pitches[i].chars = この球が運ぶことば(この文字から、次の球の直前またはフレーズ末まで)
 */
export function generatePitches(song, diffName) {
  const D = DIFFS[diffName] || DIFFS.EASY;
  const bm = beatMs(song.beats);
  const times = song.beats.map((b) => b.t);
  const cands = [];
  song.phrases.forEach((ph, pi) => {
    let head = true;
    ph.chars.forEach((c, ci) => {
      if (NOT_A_SYLLABLE.test(c.text)) return;
      const score =
        (head ? SCORE_PHRASE_HEAD : 0) + (c.w ? SCORE_WORD_HEAD : 0) + (distToBeat(times, c.s) < ON_BEAT_TOL ? SCORE_ON_BEAT : 0);
      head = false;
      if (score >= D.minScore) cands.push({ t: c.s, score, pi, ci });
    });
  });
  // 拍に丸めた間隔。-40ms は「ちょうど N 拍離れた音」を解析の揺れで落とさないための遊び
  const gap = bm > 0 ? Math.ceil(D.minGap / bm - 0.05) * bm - 40 : D.minGap;
  cands.sort((a, b) => b.score - a.score || a.t - b.t);
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.t - c.t) >= gap)) picked.push(c);
  }
  picked.sort((a, b) => a.t - b.t);
  const pitches = picked.map((p, idx) => {
    const ph = song.phrases[p.pi];
    const next = picked[idx + 1];
    const end = next && next.pi === p.pi ? next.ci : ph.chars.length;
    return {
      idx,
      t: p.t,
      pi: p.pi,
      ci: p.ci,
      chars: ph.chars.slice(p.ci, end).map((c) => ({ text: c.text, s: c.s })),
    };
  });
  return { pitches, flight: flightMs(bm), quota: Math.ceil(pitches.length * D.quota), beatMs: bm };
}

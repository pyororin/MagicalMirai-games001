// コード進行から「調」と「その瞬間に響く音」を求める。
// TextAlive のコード名('Esus2','AbM7','Bm(11)','Eb/Bb','N' …)を読む。

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/**
 * @returns {null | {root:number, strong:number[], weak:number[], minor:boolean, bass:number|null}}
 *  strong = 根音・3度・5度の音階(0-11)。weak = 7th/6th/9th などの添え音。N(無和音)は null。
 */
export function parseChord(name) {
  if (!name || name === "N") return null;
  const m = /^([A-G])([#b]?)(.*)$/.exec(name);
  if (!m) return null;
  let root = NOTE_PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  root = (root + 12) % 12;
  let rest = m[3];
  let bass = null;
  const sl = rest.indexOf("/");
  if (sl >= 0) {
    const b = /^([A-G])([#b]?)/.exec(rest.slice(sl + 1));
    if (b) bass = (NOTE_PC[b[1]] + (b[2] === "#" ? 1 : b[2] === "b" ? -1 : 0) + 12) % 12;
    rest = rest.slice(0, sl);
  }
  const isMaj7 = /maj|M/.test(rest);
  const minor = /^m(?!aj)/.test(rest) && !/^M/.test(rest);
  const dim = /dim/.test(rest);
  const aug = /aug/.test(rest);
  const sus2 = /sus2/.test(rest);
  const sus4 = /sus4|sus(?!2)/.test(rest);
  let third = minor || dim ? 3 : 4;
  let fifth = dim ? 6 : aug ? 8 : 7;
  const strong = [0];
  if (sus2) strong.push(2);
  else if (sus4) strong.push(5);
  else strong.push(third);
  strong.push(fifth);
  const weak = [];
  if (/7/.test(rest)) weak.push(isMaj7 ? 11 : 10);
  if (/6/.test(rest)) weak.push(9);
  if (/9|add9/.test(rest)) weak.push(2);
  if (/11/.test(rest)) weak.push(5);
  return {
    root,
    strong: strong.map((x) => (root + x) % 12),
    weak: weak.map((x) => (root + x) % 12),
    minor: minor && !dim,
    bass,
  };
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/**
 * 長調のトニックを推定する(0-11)。短調の曲は平行調(同じ音の集合)に寄る。
 * ペンタトニックは平行調で同じ音になるので、遊ぶ分にはこれで足りる。
 * @param {{s:number,e:number,name:string}[]} chords
 */
export function detectKey(chords) {
  const w = new Array(12).fill(0);
  const rootDur = new Array(12).fill(0);
  const minorRootDur = new Array(12).fill(0);
  for (const c of chords || []) {
    const p = parseChord(c.name);
    if (!p) continue;
    const d = Math.max(0, c.e - c.s) / 1000;
    for (const pc of p.strong) w[pc] += d * 2;
    w[p.root] += d; // 根音は少し重く
    for (const pc of p.weak) w[pc] += d * 0.6;
    rootDur[p.root] += d;
    if (p.minor) minorRootDur[p.root] += d;
  }
  let best = 0;
  let bestScore = -Infinity;
  for (let k = 0; k < 12; k++) {
    let sc = 0;
    for (const deg of MAJOR) sc += w[(k + deg) % 12];
    // 主和音(I か vi)に長く居るほど、その調らしい
    sc += 0.4 * rootDur[k] + 0.4 * minorRootDur[(k + 9) % 12];
    if (sc > bestScore) {
      bestScore = sc;
      best = k;
    }
  }
  return best;
}

/** 盤面の6段。ペンタトニック(ド レ ミ ソ ラ)+ 1オクターブ上のド。 */
export const ROW_COUNT = 6;
export const ROW_SEMITONES = [0, 2, 4, 7, 9, 12];
export const ROW_SOLFEGE = ["ド", "レ", "ミ", "ソ", "ラ", "ド"];

/** 各段の MIDI ノート番号。声域に収まるようトニックを G3〜F#4 に置き、1オクターブ上げる。 */
export function rowMidi(tonicPc) {
  const base = 60 + (((tonicPc + 5) % 12) - 5) + 12;
  return ROW_SEMITONES.map((s) => base + s);
}

export function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** 時刻 t のコード。区間は昇順前提。 */
export function chordAt(chords, t) {
  let lo = 0;
  let hi = (chords || []).length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = chords[mid];
    if (t < c.s) hi = mid - 1;
    else if (t >= c.e) lo = mid + 1;
    else return c;
  }
  return null;
}

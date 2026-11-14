// 譜面生成(純関数)。楽曲データ → ノーツ列。
//
//   タイミング … 歌詞のモーラ(1音)の発声時刻。拍に乗るもの・語頭・フレーズ頭を優先して間引く
//   母音       … 歌詞の読みの母音。「歌詞どおりの口の形」をするのが操作そのもの
//   音の高さ   … コード進行から推定した調のペンタトニック6段。和音の構成音に寄せ、
//                フレーズごとに山なりになるよう選ぶ(聴こえ方が曲に馴染むように)
import { splitMoras, fallbackVowel, kanaVowel, toHira } from "./vowel.js";
import { detectKey, parseChord, chordAt, rowMidi, ROW_COUNT } from "./key.js";

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
      chars: p.chars.map((c) => ({ text: c[0], reading: c[1], s: c[2], e: c[3], w: !!c[4] })),
    })),
  };
}

/**
 * 難易度。gapDiff = 母音が変わるときの最小間隔(ms)。ピンチを作り直す時間が要る。
 * gapSame = 同じ母音が続くときの最小間隔。
 * grid = 拍のどこまで細かく採るか(拍の何分割まで許すか)。
 */
export const DIFFS = {
  EASY: { gapDiff: 760, gapSame: 480, grid: 1, holdMin: 520 },
  NORMAL: { gapDiff: 480, gapSame: 300, grid: 2, holdMin: 460 },
  HARD: { gapDiff: 320, gapSame: 200, grid: 4, holdMin: 420 },
};

/** 決定的な疑似乱数(曲とノーツ番号で同じ譜面になるように)。 */
function hash01(n) {
  let x = (n | 0) * 2654435761;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return ((x >>> 0) % 10000) / 10000;
}

function beatIndexAt(beats, t) {
  let lo = 0;
  let hi = beats.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 時刻 t が拍の何分割目の格子に乗っているか。乗っていれば 0〜1 の近さ、外れていれば -1。 */
function gridDistance(beats, t, div) {
  if (!beats.length) return 1e9;
  const i = beatIndexAt(beats, t);
  const b = beats[i];
  const next = beats[i + 1];
  const dur = next ? next.t - b.t : i > 0 ? b.t - beats[i - 1].t : 500;
  const phase = (t - b.t) / dur; // 0..1
  const step = 1 / div;
  const nearest = Math.round(phase / step) * step;
  return Math.abs(phase - nearest) * dur; // ms
}

function beatLenAt(beats, t) {
  const i = beatIndexAt(beats, t);
  const next = beats[i + 1];
  return next ? next.t - beats[i].t : i > 0 ? beats[i].t - beats[i - 1].t : 500;
}

/** 歌詞 → モーラ単位の発声イベント */
export function extractEvents(song) {
  const events = [];
  song.phrases.forEach((ph, pi) => {
    ph.chars.forEach((ch, ci) => {
      const dur = Math.max(ch.e - ch.s, 60);
      let moras = splitMoras(ch.reading);
      if (!moras.length && !(ch.reading || "").length) {
        // 読みが無い: かなならそのまま、それ以外(漢字・英字)は決定的に割り当て。記号は無音
        const v = kanaVowel(ch.text);
        if (v) moras = [{ kana: toHira(ch.text), v, ext: 0 }];
        else if (/[一-鿿々A-Za-z0-9]/.test(ch.text)) moras = [{ kana: ch.text, v: fallbackVowel(ch.text, ci), ext: 0 }];
      }
      moras.forEach((m, mi) => {
        const t = ch.s + (dur * mi) / moras.length;
        // 長音(ー)は、そのモーラの尾に足す
        const end = ch.s + (dur * (mi + 1)) / moras.length;
        events.push({
          t,
          end,
          vowel: m.v,
          kana: m.kana,
          text: ch.text,
          phrase: pi,
          word: ci === 0 || ch.w,
          first: ci === 0 && mi === 0,
          lastOfPhrase: false,
        });
      });
    });
    // フレーズ最後のイベントに印
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].phrase === pi) {
        events[i].lastOfPhrase = true;
        break;
      }
    }
  });
  return events;
}

/** 優先度。拍・語頭・フレーズ頭ほど残したい。 */
function priority(ev, beats, grid) {
  let p = 0;
  if (ev.first) p += 3;
  if (ev.word) p += 1.5;
  const onBeat = gridDistance(beats, ev.t, 1) < 70;
  if (onBeat) p += 2;
  else if (grid >= 2 && gridDistance(beats, ev.t, 2) < 60) p += 1;
  else if (grid >= 4 && gridDistance(beats, ev.t, 4) < 45) p += 0.4;
  // 小節頭
  const b = beats[beatIndexAt(beats, ev.t)];
  if (b && b.pos === 1 && onBeat) p += 1;
  return p;
}

/** 難易度ごとに間引く */
export function selectEvents(events, beats, diff) {
  const cfg = DIFFS[diff] || DIFFS.NORMAL;
  const ranked = events
    .map((ev, i) => ({ ev, i, pr: priority(ev, beats, cfg.grid) }))
    .filter((x) => {
      // 格子に乗らないものは、grid より細かい分割では採らない
      const d = gridDistance(beats, x.ev.t, cfg.grid);
      return !beats.length || d < Math.min(110, beatLenAt(beats, x.ev.t) * 0.16);
    })
    .sort((a, b) => b.pr - a.pr || a.ev.t - b.ev.t);
  const kept = []; // 時刻順に保つ
  const insertAt = (t) => {
    let lo = 0;
    let hi = kept.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (kept[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const need = (a, b) => (a.vowel === b.vowel ? cfg.gapSame : cfg.gapDiff);
  for (const { ev } of ranked) {
    const pos = insertAt(ev.t);
    const prev = kept[pos - 1];
    const next = kept[pos];
    if (prev && ev.t - prev.t < need(prev, ev)) continue;
    if (next && next.t - ev.t < need(ev, next)) continue;
    kept.splice(pos, 0, ev);
  }
  return kept;
}

/** 音の高さ(0..ROW_COUNT-1)をコードと流れから決める */
export function assignRows(events, song, tonicPc) {
  const midis = rowMidi(tonicPc);
  const pcs = midis.map((m) => m % 12);
  const tonic = tonicPc % 12;
  let prev = 2;
  let same = 0;
  const phraseIdx = {};
  events.forEach((e) => {
    (phraseIdx[e.phrase] = phraseIdx[e.phrase] || []).push(e);
  });
  const rows = [];
  events.forEach((ev, n) => {
    const grp = phraseIdx[ev.phrase];
    const k = grp.indexOf(ev);
    const prog = grp.length > 1 ? k / (grp.length - 1) : 0.5;
    // フレーズの山: 低め→高め→落ち着く。フレーズごとに山の高さを少し変える
    const peak = 3 + Math.floor(hash01(ev.phrase * 31 + 7) * 3); // 3..5
    const target = 1 + (peak - 1) * Math.sin(Math.PI * Math.min(prog * 1.1, 1));
    const chord = parseChord((chordAt(song.chords, ev.t) || {}).name);
    let best = 0;
    let bestScore = -1e9;
    for (let r = 0; r < ROW_COUNT; r++) {
      const pc = pcs[r];
      let sc = 0;
      if (chord) {
        if (pc === chord.root) sc += 3.2;
        else if (chord.strong.includes(pc)) sc += 2.6;
        else if (chord.weak.includes(pc)) sc += 1.2;
        // 構成音の半音上は濁る
        else if (chord.strong.some((c) => (c + 1) % 12 === pc)) sc -= 2.2;
      } else {
        sc += pc === tonic ? 2 : 1;
      }
      sc -= Math.abs(r - prev) * 0.95;
      if (r === prev) sc -= same >= 1 ? 1.6 : 0.5;
      sc -= Math.abs(r - target) * 0.55;
      if (ev.lastOfPhrase && (pc === tonic || (chord && pc === chord.root))) sc += 2;
      sc += hash01(n * 977 + r * 131 + ev.phrase) * 0.9;
      if (sc > bestScore) {
        bestScore = sc;
        best = r;
      }
    }
    same = best === prev ? same + 1 : 0;
    prev = best;
    rows.push(best);
  });
  return rows;
}

/**
 * @typedef {{t:number, dur:number, hold:boolean, row:number, vowel:string, kana:string, text:string, phrase:number}} Note
 * @returns {{notes:Note[], tonic:number, diff:string}}
 */
export function buildChart(song, diff = "NORMAL") {
  const cfg = DIFFS[diff] || DIFFS.NORMAL;
  const tonic = detectKey(song.chords);
  const events = extractEvents(song);
  const kept = selectEvents(events, song.beats, diff);
  const rows = assignRows(kept, song, tonic);
  const notes = kept.map((ev, i) => {
    const next = kept[i + 1];
    // 持続: 発声が続いている長さ(長音「ー」を含む)。次のノーツの手前で切る
    const sung = ev.end - ev.t;
    const room = next ? next.t - ev.t - 90 : sung;
    const dur = Math.min(sung, room);
    const hold = dur >= cfg.holdMin;
    return {
      t: Math.round(ev.t),
      dur: hold ? Math.round(dur) : 0,
      hold,
      row: rows[i],
      vowel: ev.vowel,
      kana: ev.kana,
      text: ev.text,
      phrase: ev.phrase,
    };
  });
  return { notes, tonic, diff };
}

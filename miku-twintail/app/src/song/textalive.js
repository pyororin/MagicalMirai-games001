/* =============================================================================
 * TextAlive App API アダプタ。実曲の拍・歌詞・ボーカル音量をゲームへ渡す。
 *
 * 拍は player.data.getBeats()（IBeat[]）から小節へ束ねる。IBeat は
 *   startTime[ms] / duration[ms] / position(小節内 1 始まり) / length(小節の拍数)
 * を持つので、position===1 を境目にして小節を切り出せる。
 *
 * 拍子は曲によって変わる（課題曲にも 6 拍子の曲がある）ので、
 * 「小節の最後の拍で確定・その 2 拍前でタップ」と定義して拍子に依存させない。
 * 四拍子ならこれは「4 拍目で髪・2 拍目で髪留め」と同じになる。
 * ========================================================================== */
import * as A from "../game/audio.js";

export function createTextAliveSong(player) {
  let bars = [], flat = [], duration = 0, hot = [];

  /* 盛り上がり区間の検出。
   * findChorus() は課題曲では 1 区間しか返らないことがあり
   * （「ハロー、フェルミ。」ではイントロの 2〜13 秒だけ）、
   * それだけに頼るとサビ演出がほとんど出ない / 出る場所が曲とずれる。
   * そこでボーカル音量の包絡を 4 秒でならし、その上位 30% にあたる区間を
   * 「盛り上がり」として補う。findChorus の結果とのORを chorusAt が返す。
   *
   * しきい値をピーク比（例「ピークの 62%」）で決めると、ならした包絡は
   * 歌っている間ずっと平らなので曲の 5〜9 割が該当してしまい、サビが
   * 「常時オン」になって意味を失う。曲ごとの分布に対する分位点で切ると、
   * どの曲でも 3 割前後に収まる。 */
  const HOT_STEP = 0.5, HOT_SMOOTH = 4, HOT_PCT = 0.70, HOT_MIN = 8, HOT_GAP = 4;
  function buildHot() {
    hot = [];
    if (!duration) return;
    let max = 0;
    try { max = player.getMaxVocalAmplitude() || 0; } catch (e) { return; }
    if (!max) return;
    const n = Math.floor(duration / HOT_STEP);
    const amp = new Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      try { v = player.getVocalAmplitude(i * HOT_STEP * 1000) / max; } catch (e) { v = 0; }
      amp[i] = Math.max(0, Math.min(1, v || 0));
    }
    const w = Math.round(HOT_SMOOTH / HOT_STEP), sm = new Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0, c = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { a += amp[j]; c++; }
      sm[i] = a / c;
    }
    const sorted = sm.slice().sort((a, b) => a - b);
    const th = sorted[Math.min(n - 1, Math.floor(n * HOT_PCT))];
    if (!(th > 0)) return;
    const runs = [];
    let start = -1;
    for (let i = 0; i < n; i++) {
      if (sm[i] >= th) { if (start < 0) start = i; }
      else if (start >= 0) { runs.push([start, i]); start = -1; }
    }
    if (start >= 0) runs.push([start, n]);
    for (const [a, b] of runs) {                      // 短い隙間は繋ぎ、短すぎる山は捨てる
      const seg = { s: a * HOT_STEP, e: b * HOT_STEP };
      const last = hot[hot.length - 1];
      if (last && seg.s - last.e < HOT_GAP) last.e = seg.e;
      else hot.push(seg);
    }
    hot = hot.filter(r => r.e - r.s >= HOT_MIN);
  }

  /** 拍列を小節へ束ねる。頭とお尻の欠けた小節、3 拍未満の小節は捨てる */
  function rebuild() {
    bars = []; flat = [];
    const d = player.data;
    const bs = (d && (typeof d.getBeats === "function" ? d.getBeats() : d.beats)) || [];
    if (!bs.length) return;
    let cur = [];
    for (const b of bs) {
      if (b.position === 1) { if (cur.length >= 3) bars.push(cur); cur = []; }
      if (b.position === 1 || cur.length) cur.push(b);
    }
    if (cur.length >= 3) bars.push(cur);
    bars = bars.map((beats, i) => {
      const t = beats.map(b => b.startTime / 1000);
      const dur = beats.reduce((a, b) => a + b.duration / 1000, 0) / beats.length;
      const tieIdx = Math.max(0, t.length - 2);      // 確定の 1 拍前が髪留め
      return { i, beats: beats.map((b, j) => ({ t: t[j], pos: b.position })),
               tieIdx, tap: t[tieIdx], done: t[t.length - 1], dur };
    });
    bars.forEach(bar => bar.beats.forEach((b, j) => flat.push({
      k: flat.length, t: b.t, pos: b.pos, bar: bar.i, dur: bar.dur,
      last: j === bar.beats.length - 1 })));
    duration = (player.video && player.video.duration ? player.video.duration / 1000 : 0)
            || (flat.length ? flat[flat.length - 1].t + 2 : 0);
    buildHot();
  }

  const posSec = () => (player.timer ? player.timer.position / 1000 : 0);

  /* コード名（"Am" / "EM7/F" / "Bb" など）を A4=0 の半音オフセット 3 音へ。
   * スラッシュコードはベース音を捨てて上物だけを見る（合いの手にはそれで足りる）。*/
  const PC = { C: 3, D: 5, E: 7, F: 8, G: 10, A: 0, B: 2 };
  function chordTones(name) {
    if (!name) return null;
    const head = String(name).split("/")[0].trim();
    const m = /^([A-G])([#b]?)(.*)$/.exec(head);
    if (!m) return null;
    let root = PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    root = ((root % 12) + 12) % 12;
    const rest = m[3];
    if (/^sus2/.test(rest)) return [root, root + 2, root + 7];
    if (/^sus4?/.test(rest)) return [root, root + 5, root + 7];
    const minor = /^m(?!aj)/.test(rest);
    const dim = /^(dim|o)/.test(rest);
    const aug = /^(aug|\+)/.test(rest);
    const third = minor || dim ? 3 : 4;
    const fifth = dim ? 6 : aug ? 8 : 7;
    return [root, root + third, root + fifth];
  }

  return {
    name: "TextAlive",
    rebuild,
    barCount: () => bars.length,
    ready: () => bars.length > 0,
    time: posSec,
    /** 曲時刻 → AudioContext 時刻。先読みは 0.3 秒以内なので推定で足りる */
    atAudio: s => A.ac.currentTime + (s - posSec()),
    beat: k => (k >= 0 && k < flat.length ? flat[k] : null),
    bar: i => (i >= 0 && i < bars.length ? bars[i] : null),
    barIndexAt(sec) {
      let lo = 0, hi = bars.length - 1, ans = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1;
        if (bars[m].beats[0].t <= sec) { ans = m; lo = m + 1; } else hi = m - 1; }
      return ans;
    },
    onBeat() { /* 実曲では伴奏を合成しない。拍の音だけを重ねる */ },
    pause() { try { player.requestPause(); } catch (e) { /* 未再生なら何もしない */ } },
    resume() { try { player.requestPlay(); } catch (e) { /* 同上 */ } },
    /** いま鳴っているコード。効果音の音程合わせに使う（findChord） */
    chordAt(sec) {
      try {
        const c = player.findChord(sec * 1000);
        if (!c) return null;
        const tones = chordTones(c.name);
        return tones ? { name: c.name, tones } : null;
      } catch (e) { return null; }
    },
    /** 盛り上がり区間か。findChorus の結果と、ボーカル音量から求めた山のOR。
     *  ここが true の間は髪型がロング寄りになり、決めポーズが出る */
    chorusAt(sec) {
      try { if (player.findChorus(sec * 1000)) return true; } catch (e) { /* 続けて包絡を見る */ }
      for (const r of hot) if (sec >= r.s && sec < r.e) return true;
      return false;
    },
    hotSections: () => hot.slice(),
    charAt(sec) {
      if (!player.video) return null;
      const c = player.video.findChar(sec * 1000, { loose: true });
      return c ? c.text : null;
    },
    vocalAt(sec) {
      try {
        const max = player.getMaxVocalAmplitude() || 1;
        return Math.max(0, Math.min(1, player.getVocalAmplitude(sec * 1000) / max));
      } catch (e) { return 0; }
    },
    ended: () => duration > 0 && posSec() >= duration - 0.15,
  };
}

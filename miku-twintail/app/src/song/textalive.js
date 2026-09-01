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
  let bars = [], flat = [], duration = 0;

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
      const tapIdx = Math.max(0, t.length - 3);      // 確定の 2 拍前が髪留め
      return { i, beats: beats.map((b, j) => ({ t: t[j], pos: b.position })),
               tapIdx, tap: t[tapIdx], done: t[t.length - 1], dur };
    });
    bars.forEach(bar => bar.beats.forEach((b, j) => flat.push({
      k: flat.length, t: b.t, pos: b.pos, bar: bar.i, dur: bar.dur,
      last: j === bar.beats.length - 1 })));
    duration = (player.video && player.video.duration ? player.video.duration / 1000 : 0)
            || (flat.length ? flat[flat.length - 1].t + 2 : 0);
  }

  const posSec = () => (player.timer ? player.timer.position / 1000 : 0);

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

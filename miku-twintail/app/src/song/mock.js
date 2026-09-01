/* =============================================================================
 * 擬似曲アダプタ。TextAlive に繋がなくてもゲームの手触りを検証できるようにする。
 * 130BPM の四拍子を自前で合成し、実曲アダプタと同じ契約を満たす。
 * ========================================================================== */
import * as A from "../game/audio.js";

const LYRIC = [..."ミクノホンタイハツインテールデアルコエガカタチヲツクル"];
const SCALE_RIFF = [7, 10, 12, 10, 7, 5, 3, 5];
const BASS = [0, 0, -5, -5, -7, -7, -3, -3];
const CHORD = [[0, 3, 7], [0, 3, 7], [-5, -1, 2], [-5, -1, 2],
               [-7, -3, 0], [-7, -3, 0], [-3, 0, 4], [-3, 0, 4]];

export function createMockSong({ bpm = 130, bars = 40 } = {}) {
  const BEAT = 60 / bpm, BAR = BEAT * 4, TOTAL = bars * 4;
  let startAt = 0;
  return {
    name: `擬似曲（${bpm}BPM / ${bars}小節）`,
    start() { A.initAudio(); startAt = A.ac.currentTime + 0.2; },
    ready: () => true,
    time: () => (A.ac ? A.ac.currentTime - startAt : 0),
    atAudio: s => startAt + s,
    beat(k) {
      if (k < 0 || k >= TOTAL) return null;
      return { k, t: k * BEAT, pos: (k % 4) + 1, bar: Math.floor(k / 4), dur: BEAT, last: k % 4 === 3 };
    },
    bar(i) {
      if (i < 0 || i >= bars) return null;
      const beats = [0, 1, 2, 3].map(j => ({ t: (i * 4 + j) * BEAT, pos: j + 1 }));
      return { i, beats, tapIdx: 1, tap: beats[1].t, done: beats[3].t, dur: BEAT };
    },
    barIndexAt: sec => Math.floor(sec / BAR),
    /** 伴奏。拍の音を邪魔しないよう songGain(0.8) 側で鳴らす */
    onBeat(b, at) {
      const i = b.k % 8, inBar = b.k % 4;
      if (inBar === 0 || (inBar === 2 && i % 8 !== 6)) A.kick(at);
      if (inBar === 2) A.snare(at);
      A.osc(at, 55 * Math.pow(2, BASS[i] / 12), "triangle", 0.16, BEAT * 0.9, A.songGain);
      if (inBar === 0) for (const st of CHORD[i])
        A.osc(at, 220 * Math.pow(2, st / 12), "sawtooth", 0.028, BEAT * 1.8, A.songGain, 0, 0.04);
      A.osc(at, 440 * Math.pow(2, SCALE_RIFF[i] / 12), "square", 0.045, BEAT * 0.42, A.songGain, -0.25);
      if (i % 2 === 1) A.osc(at + BEAT / 2, 440 * Math.pow(2, SCALE_RIFF[(i + 1) % 8] / 12),
                             "square", 0.028, BEAT * 0.3, A.songGain, 0.25);
    },
    charAt: sec => LYRIC[Math.floor(sec / BEAT * 2) % LYRIC.length],
    vocalAt: sec => 0.5 + 0.5 * Math.sin(sec * 3.1),
    ended: () => (A.ac ? A.ac.currentTime - startAt : 0) > TOTAL * BEAT + 1.2,
  };
}

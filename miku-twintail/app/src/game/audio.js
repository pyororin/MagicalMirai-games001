/* =============================================================================
 * 音まわり。拍の音（beat）・効果音（sfx）・擬似曲パート（song）を分けて出す。
 *   beat 1.0 / sfx 0.95 / song 0.8 ── 実曲を鳴らすときも拍の音を埋もれさせない
 * ========================================================================== */

export let ac = null, master = null, songGain = null, beatGain = null, sfxGain = null;
let NOISE = null;

export function initAudio() {
  if (ac) return ac;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
  songGain = ac.createGain(); songGain.gain.value = 0.8; songGain.connect(master);
  beatGain = ac.createGain(); beatGain.gain.value = 1.0; beatGain.connect(master);
  sfxGain = ac.createGain(); sfxGain.gain.value = 0.95; sfxGain.connect(master);
  const b = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  NOISE = b;
  return ac;
}
/** 自動再生ポリシー対策。ユーザー操作の中から必ず一度通す */
export function unlockAudio() {
  initAudio();
  if (ac.state === "suspended") ac.resume();
  const s = ac.createBufferSource();
  s.buffer = ac.createBuffer(1, 1, ac.sampleRate); s.connect(master); s.start();
  return ac.state;
}
export const audioState = () => (ac ? ac.state : "none");

export function env(g, at, peak, dur, atk = 0.008) {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
}
export function osc(at, freq, type, peak, dur, dest, pan = 0, atk = 0.008) {
  const o = ac.createOscillator(), g = ac.createGain(), p = ac.createStereoPanner();
  o.type = type; o.frequency.setValueAtTime(freq, at); p.pan.value = pan;
  env(g, at, peak, dur, atk);
  o.connect(g); g.connect(p); p.connect(dest); o.start(at); o.stop(at + dur + 0.06);
  return o;
}
export function noiseSource() { const s = ac.createBufferSource(); s.buffer = NOISE; return s; }

/* ---- 擬似曲のパート（モック専用）------------------------------------- */
export function kick(at) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(150, at);
  o.frequency.exponentialRampToValueAtTime(45, at + 0.1);
  env(g, at, 0.6, 0.16, 0.004);
  o.connect(g); g.connect(songGain); o.start(at); o.stop(at + 0.28);
}
export function snare(at) {
  const s = noiseSource();
  const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.8;
  const g = ac.createGain(); env(g, at, 0.22, 0.13, 0.002);
  s.connect(f); f.connect(g); g.connect(songGain); s.start(at); s.stop(at + 0.2);
}

/* ---- 拍の音（beatGain。前に出す）-------------------------------------- */
/** 素の拍。1・3 拍目の土台 */
export function click(at, strong) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "square"; o.frequency.setValueAtTime(strong ? 900 : 1250, at);
  o.frequency.exponentialRampToValueAtTime(strong ? 420 : 700, at + 0.03);
  env(g, at, strong ? 0.17 : 0.10, 0.05, 0.002);
  const f = ac.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.6;
  f.frequency.value = strong ? 900 : 1400;
  o.connect(f); f.connect(g); g.connect(beatGain); o.start(at); o.stop(at + 0.12);
}
/** 髪留めの拍（TAP）: 硬く高い「カンッ」。左右に定位する。
 *  chord は曲のコードトーン（A4=0 の半音オフセット配列）。渡すと曲にハモる */
export function tieBeat(at, pan, chord) {
  const p = ac.createStereoPanner(); p.pan.value = pan; p.connect(beatGain);
  const base = chord ? 440 * Math.pow(2, (chord[0] + 24) / 12) : 2093;
  const tones = chord
    ? [[base, 0.20, 0.34], [base * Math.pow(2, chord[2] / 12) / 2, 0.10, 0.24], [base * 2, 0.05, 0.16]]
    : [[2093, 0.20, 0.34], [3136, 0.10, 0.24], [4186, 0.05, 0.16]];
  for (const [f, v, d] of tones) osc(at, f, "sine", v, d, p, 0, 0.002);
  const s = noiseSource();
  const bf = ac.createBiquadFilter(); bf.type = "highpass"; bf.frequency.value = 6000;
  const g = ac.createGain(); env(g, at, 0.10, 0.05, 0.001);
  s.connect(bf); bf.connect(g); g.connect(p); s.start(at); s.stop(at + 0.1);
}
/** 髪の毛の拍（確定）: やわらかく低い「ポワーン」。コードがあれば三和音で鳴らす */
export function hairBeat(at, pan, chord) {
  const p = ac.createStereoPanner(); p.pan.value = pan; p.connect(beatGain);
  if (chord) {
    const f = st => 440 * Math.pow(2, (st + 12) / 12);
    for (const [st, v, d] of [[chord[0], 0.15, 0.5], [chord[1], 0.07, 0.42], [chord[2], 0.08, 0.46]])
      osc(at, f(st), "triangle", v, d, p, 0, 0.02);
    osc(at, f(chord[0]) / 2, "triangle", 0.09, 0.55, p, 0, 0.02);
    return;
  }
  for (const [f, v, d] of [[784, 0.17, 0.5], [1176, 0.07, 0.4], [392, 0.09, 0.55]])
    osc(at, f, "triangle", v, d, p, 0, 0.02);
}

/* ---- 効果音（sfxGain）------------------------------------------------- */
/** 伸ばしている間の「シャラララー」。コードトーンを積み上げて登らせるので、
 *  曲の和音から外れた音が鳴らない（findChord の使いどころ） */
export function shimmer(at, dur, pan, chord) {
  const g = ac.createGain(); g.gain.value = 1;
  const p = ac.createStereoPanner(); p.pan.value = pan;
  g.connect(p); p.connect(sfxGain);
  const n = 11, step = dur / n;
  const st = chord
    ? Array.from({ length: n }, (_, i) => chord[i % 3] + 12 * Math.floor(i / 3))
    : [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  for (let i = 0; i < n; i++)
    osc(at + i * step, 523.25 * Math.pow(2, st[i] / 12), "sine", 0.10, step * 2.4, g, 0, 0.004);
  return g;
}
export function shakin(at, pan, chord) {
  const p = ac.createStereoPanner(); p.pan.value = pan; p.connect(sfxGain);
  const s = noiseSource();
  const f = ac.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 2.5;
  f.frequency.setValueAtTime(2500, at);
  f.frequency.exponentialRampToValueAtTime(7000, at + 0.09);
  const g = ac.createGain(); env(g, at, 0.3, 0.42, 0.003);
  s.connect(f); f.connect(g); g.connect(p); s.start(at); s.stop(at + 0.6);
  // 落ち着く先の音程をコードの第 5 音に合わせる（合わない「シャキーン」は耳につく）
  const land = chord ? 440 * Math.pow(2, (chord[2] + 24) / 12) : 1900;
  const o = ac.createOscillator(), og = ac.createGain();
  o.type = "triangle"; o.frequency.setValueAtTime(land * 1.8, at);
  o.frequency.exponentialRampToValueAtTime(land, at + 0.3);
  env(og, at, 0.16, 0.38, 0.003);
  o.connect(og); og.connect(p); o.start(at); o.stop(at + 0.5);
}
/** サビの決めポーズ。コードの分散和音を駆け上がる短いキメ */
export function kime(at, chord) {
  const out = ac.createGain(); out.gain.value = 1; out.connect(sfxGain);
  const c = chord || [0, 4, 7];
  [c[0], c[1], c[2], c[0] + 12].forEach((st, i) =>
    osc(at + i * 0.045, 440 * Math.pow(2, (st + 12) / 12), "square", 0.13, 0.3, out, 0, 0.003));
  const s = noiseSource();
  const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 5000;
  const g = ac.createGain(); env(g, at, 0.12, 0.25, 0.002);
  s.connect(f); f.connect(g); g.connect(out); s.start(at); s.stop(at + 0.35);
}
/** ネギ確定。クイズの不正解のような、あからさまな「ブッブー」 */
export function buzzer(at) {
  const out = ac.createGain(); out.gain.value = 1; out.connect(sfxGain);
  for (const [t0, dur] of [[0, 0.13], [0.18, 0.32]])
    for (const f of [196, 155, 98]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.value = f;
      env(g, at + t0, 0.15, dur, 0.004);
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1500;
      o.connect(lp); lp.connect(g); g.connect(out); o.start(at + t0); o.stop(at + t0 + dur + 0.06);
    }
}
export function flop(at) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "sawtooth"; o.frequency.setValueAtTime(320, at);
  o.frequency.exponentialRampToValueAtTime(70, at + 0.25);
  env(g, at, 0.12, 0.3, 0.006);
  const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
  o.connect(f); f.connect(g); g.connect(sfxGain); o.start(at); o.stop(at + 0.4);
}
export function fanfare(at) {
  const out = ac.createGain(); out.gain.value = 1; out.connect(sfxGain);
  [0, 4, 7, 12].forEach((st, i) =>
    osc(at + i * 0.08, 523.25 * Math.pow(2, st / 12), "triangle", 0.16, 0.5, out, 0, 0.005));
}
/** 掛け声。ミクの音声素材は使わず、ブラウザの音声合成で読み上げる */
export function say(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP"; u.rate = 1.3; u.pitch = 1.8; u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch (e) { /* 読み上げ不可の環境は無音でよい */ }
}

// ミクの歌声っぽい「あ・い・う・え・お」を出すモノフォニック・ボイス。
//
//   声帯(なめらかな倍音列)+息 → 5本のフォルマント(口の形) → 歌手フォルマント → エンベロープ
//
// 本物の歌声(音声ライブラリ)は使えないので、日本語の母音のフォルマントを、
// 少し高め(小柄な女声)に取って合成する。ピンチの量 = 口の形の混ざり具合なので、
// 指を開閉するにつれ「あ → い」のように母音がなめらかに変わる(顔の変形と同じ重み)。
//
// 発声のきっかけ: 盤面(音の高さ)をタップしていて、かつ顔をピンチしているあいだだけ鳴る。
//
// レイテンシ対策(ontology/rhythm-game.yaml の oscillator-per-hit-latency):
// 打鍵のたびにノードを作らず、最初のユーザー操作でグラフを1本だけ作り、
// 以降は AudioParam を動かすだけにする。
import { VOWELS } from "./vowel.js";

// 日本語母音のフォルマント(Hz): F1, F2, F3(成人女性の目安をやや高めに)
export const FORMANTS = {
  a: [800, 1250, 2600],
  i: [290, 2250, 3100],
  u: [320, 1050, 2350],
  e: [520, 1900, 2650],
  o: [500, 900, 2450],
};
const FEMALE = 1.1; // 声道を短く=フォルマント全体を持ち上げる(ミクらしい明るさ)
const FIXED_F = [3400, 4500]; // F4, F5 は母音によらずほぼ一定
// 母音ごとの音量補正(口が閉じる母音は小さく聞こえるので持ち上げる)
const LEVEL = { a: 1.0, i: 0.98, u: 0.9, e: 1.03, o: 1.17 }; // 392Hz/659Hz で測った RMS をそろえた値
// 高域(F4,F5)の明るさ。い・えは明るく、う・おは暗く(母音らしさの大きな手がかり)
const BRIGHT = { a: 0.8, i: 1.3, u: 0.2, e: 1.0, o: 0.35 };
const HARMONICS = 40;

export class Voice {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.on = false;
    this.freq = 440;
    this.mouthW = { a: 1, i: 0, u: 0, e: 0, o: 0 };
    this.log = { noteOn: 0, createdNodes: 0 }; // 検証用(プレイ中にノード生成が増えないこと)
  }

  /** ユーザー操作の中で呼ぶ。2回目以降は resume だけ。 */
  unlock() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback"; // iOS 16.4+: マナースイッチで消えない
    } catch (e) {}
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      let ctx;
      try {
        ctx = new AC({ latencyHint: 0 });
      } catch (e1) {
        try {
          ctx = new AC({ latencyHint: "interactive" });
        } catch (e2) {
          ctx = new AC();
        }
      }
      this.attach(ctx);
    }
    if (this.ctx.state !== "running") {
      try {
        this.ctx.resume();
      } catch (e) {}
    }
    return this.ctx;
  }

  /** 任意の AudioContext(オフラインレンダリング含む)にグラフを組む */
  attach(ctx) {
    this.ctx = ctx;
    this._build();
  }

  _build() {
    const ctx = this.ctx;
    const n = (x) => {
      this.log.createdNodes++;
      return x;
    };
    this.master = n(ctx.createGain());
    this.master.gain.value = 0.85;
    this.comp = n(ctx.createDynamicsCompressor());
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // 声帯: 倍音が 1/n^1.15 で減る、のこぎりよりやや丸い波(声門波に近い)。
    // 2本を数セントずらして重ね、機械的な単調さを消す
    const re = new Float32Array(HARMONICS + 1);
    const im = new Float32Array(HARMONICS + 1);
    for (let k = 1; k <= HARMONICS; k++) im[k] = 1 / Math.pow(k, 1.15);
    const wave = ctx.createPeriodicWave(re, im);
    this.o1 = n(ctx.createOscillator());
    this.o2 = n(ctx.createOscillator());
    this.o1.setPeriodicWave(wave);
    this.o2.setPeriodicWave(wave);
    this.o2.detune.value = 7;
    this.o1G = n(ctx.createGain());
    this.o2G = n(ctx.createGain());
    this.o1G.gain.value = 0.62;
    this.o2G.gain.value = 0.38;
    this.src = n(ctx.createGain());
    this.o1.connect(this.o1G).connect(this.src);
    this.o2.connect(this.o2G).connect(this.src);

    // 息(ささやき成分): 常に少し、立ち上がりに少し多く
    const len = Math.floor(ctx.sampleRate * 1.0);
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n(ctx.createBufferSource());
    this.noise.buffer = nb;
    this.noise.loop = true;
    this.breathG = n(ctx.createGain());
    this.breathG.gain.value = 0;
    this.noise.connect(this.breathG);

    // フォルマント(5本並列)
    this.fl = [];
    this.fg = [];
    const Q = [5, 6, 7, 8, 9];
    const G = [1.0, 1.1, 0.8, 0.4, 0.2];
    this.G = G;
    this.mix = n(ctx.createGain());
    this.mix.gain.value = 1;
    for (let i = 0; i < 5; i++) {
      const f = n(ctx.createBiquadFilter());
      f.type = "bandpass";
      f.Q.value = Q[i];
      f.frequency.value = i < 3 ? FORMANTS.a[i] * FEMALE : FIXED_F[i - 3];
      const g = n(ctx.createGain());
      g.gain.value = G[i];
      this.src.connect(f);
      this.breathG.connect(f);
      f.connect(g);
      g.connect(this.mix);
      this.fl.push(f);
      this.fg.push(g);
    }
    // 歌手フォルマント(3kHz 付近の輝き)と、高域の丸め
    this.pk = n(ctx.createBiquadFilter());
    this.pk.type = "peaking";
    this.pk.frequency.value = 3000;
    this.pk.Q.value = 1.1;
    this.pk.gain.value = 5;
    this.lp = n(ctx.createBiquadFilter());
    this.lp.type = "lowpass";
    this.lp.frequency.value = 6500;
    this.env = n(ctx.createGain());
    this.env.gain.value = 0;
    this.mix.connect(this.pk).connect(this.lp).connect(this.env).connect(this.master);

    // ビブラート(押し続けると深くなる)
    this.lfo = n(ctx.createOscillator());
    this.lfo.frequency.value = 5.6;
    this.lfoG = n(ctx.createGain());
    this.lfoG.gain.value = 0;
    this.lfo.connect(this.lfoG);
    this.lfoG.connect(this.o1.detune);
    this.lfoG.connect(this.o2.detune);

    const t = ctx.currentTime;
    this.o1.frequency.value = 440;
    this.o2.frequency.value = 440;
    this.o1.start(t);
    this.o2.start(t);
    this.lfo.start(t);
    this.noise.start(t);
    // 無音1サンプルで出力経路を開ける
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.master);
      s.start(0);
    } catch (e) {}
  }

  get state() {
    return this.ctx ? this.ctx.state : "none";
  }

  get outputLatencyMs() {
    if (!this.ctx) return 0;
    return Math.round(((this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)) * 1000);
  }

  /** 口の形(重み)と声の高さからフォルマントを決める。w は {a,i,u,e,o} 合計1。 */
  setMouth(w, amount = 1) {
    if (!this.ctx) return;
    this.mouthW = w;
    this._applyFormants(amount);
  }

  _applyFormants(amount = 1) {
    const t = this.ctx.currentTime;
    const w = this.mouthW;
    const f = [0, 0, 0];
    let lvl = 0;
    for (const v of VOWELS) {
      const wk = w[v] || 0;
      for (let i = 0; i < 3; i++) f[i] += FORMANTS[v][i] * FEMALE * wk;
      lvl += LEVEL[v] * wk;
    }
    // 声が高いと F1 より基音が上になって痩せるので、F1 を基音に少し寄せる(歌手の技)。寄せすぎると母音が変わる
    const f0 = this.freq;
    f[0] = Math.max(f[0], Math.min(f0 * 0.85, f[0] * 1.6));
    for (let i = 0; i < 3; i++) this.fl[i].frequency.setTargetAtTime(f[i], t, 0.018);
    let br = 0;
    for (const v of VOWELS) br += BRIGHT[v] * (w[v] || 0);
    this.fg[3].gain.setTargetAtTime(this.G[3] * br, t, 0.03);
    this.fg[4].gain.setTargetAtTime(this.G[4] * br, t, 0.03);
    this.mix.gain.setTargetAtTime(lvl || 1, t, 0.03);
    // 大きく変形させるほど、少し明るい声になる
    this.lp.frequency.setTargetAtTime(5200 + 2400 * Math.min(1, amount), t, 0.05);
    this.lastMouth = { f: f.slice(), lvl };
  }

  /** 音を出す。glide は前の音から滑る時間(秒)。 */
  noteOn(freq, glide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.log.noteOn++;
    this.freq = freq;
    this._applyFormants(1);
    for (const o of [this.o1, this.o2]) {
      o.frequency.cancelScheduledValues(t);
      if (this.on && glide > 0) o.frequency.setTargetAtTime(freq, t, glide);
      else {
        // 歌い出しは、少し下から本来の音へ「しゃくり」上げる
        o.frequency.setValueAtTime(freq * 0.965, t);
        o.frequency.setTargetAtTime(freq, t, 0.03);
      }
    }
    this.env.gain.cancelScheduledValues(t);
    this.env.gain.setTargetAtTime(0.9, t, 0.008); // 立ち上がり 8ms(遅れて聞こえない速さ)
    // 息: 立ち上がりに少し多く、あとは薄く残す
    this.breathG.gain.cancelScheduledValues(t);
    this.breathG.gain.setValueAtTime(0.16, t);
    this.breathG.gain.setTargetAtTime(0.025, t, 0.06);
    // ビブラート: 少し遅れて乗る
    this.lfoG.gain.cancelScheduledValues(t);
    this.lfoG.gain.setValueAtTime(0, t);
    this.lfoG.gain.setValueAtTime(0, t + 0.22);
    this.lfoG.gain.linearRampToValueAtTime(22, t + 0.9);
    this.on = true;
  }

  /** 押したまま段を変えた(スティックを滑らせた) */
  glideTo(freq, tc = 0.03) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.freq = freq;
    for (const o of [this.o1, this.o2]) {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setTargetAtTime(freq, t, tc);
    }
    this._applyFormants(1);
  }

  noteOff() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.env.gain.cancelScheduledValues(t);
    this.env.gain.setTargetAtTime(0, t, 0.045);
    this.breathG.gain.cancelScheduledValues(t);
    this.breathG.gain.setTargetAtTime(0, t, 0.03);
    this.lfoG.gain.cancelScheduledValues(t);
    this.lfoG.gain.setTargetAtTime(0, t, 0.05);
    this.on = false;
  }

  setVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
}

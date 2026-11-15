// 口の形で音色が変わる、モノフォニックの合成ボイス。
//
//   のこぎり波(+ほんの少しの矩形波) → 3つの帯域フィルタ(フォルマント) → エンベロープ
//
// ピンチ = 口の形 = フォルマント。あいうえお の5母音のフォルマントを、顔と同じ重みで
// 混ぜる。だから指を開閉するにつれ、顔の変形と音色が一緒に連続して変わる。
// 音の高さ = スティック(盤面の段)。滑らせるとポルタメントでつながる。
//
// レイテンシ対策(ontology/rhythm-game.yaml の oscillator-per-hit-latency):
// 打鍵のたびにノードを作らず、最初のユーザー操作でグラフを1本だけ作り、
// 以降は AudioParam を動かすだけにする。
import { VOWELS } from "./vowel.js";

// 日本語母音のフォルマント(Hz): F1, F2, F3
export const FORMANTS = {
  a: [800, 1250, 2600],
  i: [290, 2250, 3100],
  u: [320, 1050, 2350],
  e: [520, 1900, 2650],
  o: [500, 900, 2450],
};
// 母音ごとの音量補正(口が閉じる母音は小さく聞こえるので持ち上げる)
const LEVEL = { a: 1.0, i: 1.25, u: 1.45, e: 1.1, o: 1.1 };

export class Voice {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.on = false;
    this.freq = 440;
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
      try {
        this.ctx = new AC({ latencyHint: 0 });
      } catch (e1) {
        try {
          this.ctx = new AC({ latencyHint: "interactive" });
        } catch (e2) {
          this.ctx = new AC();
        }
      }
      this._build();
    }
    if (this.ctx.state !== "running") {
      try {
        this.ctx.resume();
      } catch (e) {}
    }
    return this.ctx;
  }

  _build() {
    const ctx = this.ctx;
    const n = (x) => {
      this.log.createdNodes++;
      return x;
    };
    this.master = n(ctx.createGain());
    this.master.gain.value = 0.9;
    this.comp = n(ctx.createDynamicsCompressor());
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // 声帯
    this.saw = n(ctx.createOscillator());
    this.saw.type = "sawtooth";
    this.sq = n(ctx.createOscillator());
    this.sq.type = "square";
    this.sq.detune.value = 6;
    this.sawG = n(ctx.createGain());
    this.sawG.gain.value = 0.8;
    this.sqG = n(ctx.createGain());
    this.sqG.gain.value = 0.22;
    this.src = n(ctx.createGain());
    this.saw.connect(this.sawG).connect(this.src);
    this.sq.connect(this.sqG).connect(this.src);

    // フォルマント(3本並列)
    this.fl = [];
    this.fg = [];
    const Q = [6, 9, 12];
    const G = [1.0, 0.7, 0.35];
    this.mix = n(ctx.createGain());
    this.mix.gain.value = 1;
    for (let i = 0; i < 3; i++) {
      const f = n(ctx.createBiquadFilter());
      f.type = "bandpass";
      f.Q.value = Q[i];
      f.frequency.value = FORMANTS.a[i];
      const g = n(ctx.createGain());
      g.gain.value = G[i];
      this.src.connect(f);
      f.connect(g);
      g.connect(this.mix);
      this.fl.push(f);
      this.fg.push(g);
    }
    // 倍音の明るさを少し落とす
    this.lp = n(ctx.createBiquadFilter());
    this.lp.type = "lowpass";
    this.lp.frequency.value = 5200;
    this.env = n(ctx.createGain());
    this.env.gain.value = 0;
    this.mix.connect(this.lp).connect(this.env).connect(this.master);

    // ビブラート(押し続けると深くなる)
    this.lfo = n(ctx.createOscillator());
    this.lfo.frequency.value = 5.6;
    this.lfoG = n(ctx.createGain());
    this.lfoG.gain.value = 0;
    this.lfo.connect(this.lfoG);
    this.lfoG.connect(this.saw.detune);
    this.lfoG.connect(this.sq.detune);

    const t = ctx.currentTime;
    this.saw.start(t);
    this.sq.start(t);
    this.lfo.start(t);
    this.saw.frequency.value = 440;
    this.sq.frequency.value = 440;
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

  /** 口の形(重み)をフォルマントに反映。w は {a,i,u,e,o} 合計1。 */
  setMouth(w, amount = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = [0, 0, 0];
    let lvl = 0;
    for (const v of VOWELS) {
      const wk = w[v] || 0;
      for (let i = 0; i < 3; i++) f[i] += FORMANTS[v][i] * wk;
      lvl += LEVEL[v] * wk;
    }
    for (let i = 0; i < 3; i++) this.fl[i].frequency.setTargetAtTime(f[i], t, 0.018);
    this.mix.gain.setTargetAtTime(lvl || 1, t, 0.03);
    // 大きく変形させるほど、少し尖った音になる
    this.lp.frequency.setTargetAtTime(4200 + 2600 * Math.min(1, amount), t, 0.05);
    this.lastMouth = { f, lvl };
  }

  /** 音を出す。glide は前の音から滑る時間(秒)。 */
  noteOn(freq, glide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.log.noteOn++;
    this.freq = freq;
    for (const o of [this.saw, this.sq]) {
      o.frequency.cancelScheduledValues(t);
      if (this.on && glide > 0) o.frequency.setTargetAtTime(freq, t, glide);
      else o.frequency.setValueAtTime(freq, t);
    }
    this.env.gain.cancelScheduledValues(t);
    this.env.gain.setTargetAtTime(0.9, t, 0.006); // 立ち上がりは 6ms(遅れて聞こえない速さ)
    this.lfoG.gain.cancelScheduledValues(t);
    this.lfoG.gain.setValueAtTime(0, t);
    this.lfoG.gain.linearRampToValueAtTime(14, t + 0.7); // 押し続けると揺れが乗る
    this.on = true;
  }

  /** 押したまま段を変えた(スティックを滑らせた) */
  glideTo(freq, tc = 0.028) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.freq = freq;
    for (const o of [this.saw, this.sq]) {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setTargetAtTime(freq, t, tc);
    }
  }

  noteOff() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.env.gain.cancelScheduledValues(t);
    this.env.gain.setTargetAtTime(0, t, 0.035);
    this.lfoG.gain.cancelScheduledValues(t);
    this.lfoG.gain.setTargetAtTime(0, t, 0.05);
    this.on = false;
  }

  setVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
}

// 効果音。すべてコードで合成した自作音(docs/PRINCIPLES.md: 素材ルール)。
// ・バッファは事前に作っておき、鳴らすときは再生するだけ(ontology: oscillator-per-hit-latency)
// ・最初のユーザー操作で resume + 無音再生(ontology: webaudio-se-silent-on-mobile)
// ・楽曲の一部に聞こえないよう、短い打撃音にする。重ねない(ontology: layered-sfx-feels-late)

export class Sfx {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.volume = 0.7;
  }

  /** ユーザー操作の中で呼ぶ。 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC({ latencyHint: "interactive" });
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(this.ctx.destination);
      this._build();
      try {
        if (navigator.audioSession) navigator.audioSession.type = "playback";
      } catch (e) {}
    }
    if (this.ctx.state !== "running") this.ctx.resume().catch(() => {});
    const s = this.ctx.createBufferSource();
    s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    s.connect(this.ctx.destination);
    s.start();
    return this.ctx;
  }

  _make(sec, fn) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * sec);
    const b = this.ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = fn(i / sr, i / n);
    return b;
  }

  _build() {
    let lp = 0;
    const noise = () => Math.random() * 2 - 1;
    // 素振り: 風切り(低域を通したノイズ)
    this.buf.swing = this._make(0.13, (t, u) => {
      lp += (noise() - lp) * (0.08 + 0.3 * u);
      return lp * Math.sin(Math.PI * u) * 0.5;
    });
    // 空振り: 素振りより低く長め
    lp = 0;
    this.buf.whiff = this._make(0.2, (t, u) => {
      lp += (noise() - lp) * 0.07;
      return lp * Math.sin(Math.PI * u) * 0.7;
    });
    // ヒット: 乾いた打撃
    this.buf.hit = this._make(0.07, (t) => (noise() * Math.exp(-t * 90) * 0.6 + Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t * 60) * 0.5));
    // ホームラン: 打撃 + 短い高い響き
    this.buf.hr = this._make(0.2, (t) =>
      noise() * Math.exp(-t * 110) * 0.6 + (Math.sin(2 * Math.PI * 1900 * t) + 0.5 * Math.sin(2 * Math.PI * 2850 * t)) * Math.exp(-t * 26) * 0.35
    );
    this.buf.big = this._make(0.3, (t) =>
      noise() * Math.exp(-t * 110) * 0.7 + (Math.sin(2 * Math.PI * 2100 * t) + 0.6 * Math.sin(2 * Math.PI * 3150 * t)) * Math.exp(-t * 15) * 0.4
    );
  }

  play(name) {
    if (!this.ctx || !this.buf[name]) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buf[name];
    s.connect(this.out);
    s.start(this.ctx.currentTime + 0.003);
  }

  /** 端末の出力遅延(ms)。取れなければ null。体感の切り分け用に画面へ出す。 */
  latencyMs() {
    if (!this.ctx) return null;
    const v = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return v ? Math.round(v * 1000) : null;
  }
}

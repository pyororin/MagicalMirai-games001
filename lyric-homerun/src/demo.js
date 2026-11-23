// TextAlive に接続しない「デモ」ソース。
//   ・曲データ(拍・コード・歌詞の時刻)は data/songs/*.json の実データ
//   ・音源は無いので、コード進行のパッドと拍のクリックを合成して伴奏にする
// 用途: 1) ネットワーク制限下での動作確認  2) 自動テスト  3) 譜面の聴き比べ
import { expandSong } from "./chart.js?v=6";
import { parseChord, midiToHz } from "./key.js?v=6";
import { dataUrl } from "./songs.js?v=6";

export class DemoSource {
  constructor(build) {
    this.kind = "demo";
    this.managed = false;
    this.build = build;
    this.song = null;
    this.playing = false;
    this.base = 0;
    this.t0 = 0;
    this.ctx = null;
    this.out = null;
    this.timer = null;
    this.scheduled = new Set();
    this.volume = 0.8;
  }

  async loadSong(def) {
    const r = await fetch(dataUrl("data/songs/" + def.code + ".json", this.build), { cache: "no-cache" });
    if (!r.ok) throw new Error("曲データ取得失敗 " + r.url + " → HTTP " + r.status);
    this.song = expandSong(await r.json());
    this.playing = false;
    this.base = 0;
    return this.song;
  }

  /** 伴奏を鳴らす AudioContext を受け取る(ユーザー操作後に呼ぶ) */
  bindAudio(ctx) {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.55 * this.volume;
    this.out.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.05);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }

  getPosition() {
    return this.playing ? this.base + (performance.now() - this.t0) : this.base;
  }
  isPlaying() {
    return this.playing;
  }
  async play() {
    if (this.playing) return;
    this.t0 = performance.now();
    this.playing = true;
    this.scheduled.clear();
    this.timer = setInterval(() => this._schedule(), 30);
  }
  pause() {
    if (!this.playing) return;
    this.base = this.getPosition();
    this.playing = false;
    clearInterval(this.timer);
  }
  async seek(ms) {
    const was = this.playing;
    if (was) this.pause();
    this.base = ms;
    this.scheduled.clear();
    if (was) await this.play();
  }
  setVolume(v) {
    this.volume = v;
    if (this.out) this.out.gain.value = 0.55 * v;
  }

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.song) return;
    const pos = this.getPosition();
    const ahead = 140;
    const at = (t) => ctx.currentTime + Math.max(0, (t - pos) / 1000);
    for (const b of this.song.beats) {
      if (b.t < pos - 20) continue;
      if (b.t > pos + ahead) break;
      const key = "b" + b.t;
      if (this.scheduled.has(key)) continue;
      this.scheduled.add(key);
      this._tick(at(b.t), b.pos === 1);
    }
    for (const c of this.song.chords) {
      if (c.s < pos - 20) continue;
      if (c.s > pos + ahead) break;
      const key = "c" + c.s;
      if (this.scheduled.has(key)) continue;
      this.scheduled.add(key);
      this._pad(at(c.s), Math.min((c.e - c.s) / 1000, 2.4), c.name);
    }
    if (this.scheduled.size > 400) this.scheduled.clear();
  }

  _tick(when, down) {
    const ctx = this.ctx;
    if (down) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, when);
      o.frequency.exponentialRampToValueAtTime(48, when + 0.12);
      g.gain.setValueAtTime(0.9, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
      o.connect(g).connect(this.out);
      o.start(when);
      o.stop(when + 0.2);
    } else {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6000;
      s.connect(hp).connect(g).connect(this.out);
      s.start(when);
    }
  }

  _pad(when, dur, name) {
    const p = parseChord(name);
    if (!p) return;
    const ctx = this.ctx;
    const tones = [...p.strong, ...p.weak.slice(0, 1)];
    const base = 48; // C3
    for (const pc of tones) {
      const midi = base + ((pc - base) % 12 + 12) % 12;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = midiToHz(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.11, when + 0.04);
      g.gain.setTargetAtTime(0, when + Math.max(0.1, dur - 0.12), 0.08);
      o.connect(g).connect(this.out);
      o.start(when);
      o.stop(when + dur + 0.5);
    }
  }
}

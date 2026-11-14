// TextAlive App API につなぐソース。Player から曲データ(拍・コード・歌詞)を取り出し、
// 譜面生成が読める形(chart.js の expandSong と同じ)にそろえる。
//
// 躓きどころは ontology/textalive.yaml に集約済み:
//   card-data-resolver-unavailable … createFromSongUrl が失敗したらカード URL へフォールバック
//   side-data-races-onvideoready   … 読みデータは Promise を共有し onVideoReady 側で await
//   seek-completes-after-play-request … シーク直後は position が古い
import { dataUrl } from "./songs.js";
import { toHira } from "./vowel.js";

const APP_TOKEN = "VQRxHB1a0q8fVvnm"; // 公開前提のクライアント埋め込みトークン

export class TextAliveSource {
  constructor({ build, mediaEl, onDiag, onManaged }) {
    this.kind = "textalive";
    this.build = build;
    this.mediaEl = mediaEl;
    this.onDiag = onDiag || (() => {});
    this.player = null;
    this.managed = false;
    this.song = null;
    this.netDiag = [];
    this.handlers = { ready: [], error: [], end: [], appReady: [], mediaChange: [], timerReady: [] };
    this.readingsPromise = null;
    this.lastSong = null;
    this._wrapNetwork();
  }

  on(ev, fn) {
    this.handlers[ev].push(fn);
  }
  _emit(ev, ...a) {
    for (const f of this.handlers[ev]) {
      try {
        f(...a);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /** 失敗した通信の URL とステータスを記録する(原因の切り分け用) */
  _wrapNetwork() {
    const diag = this.netDiag;
    if (window.axios && axios.interceptors) {
      axios.interceptors.response.use(
        (r) => r,
        (e) => {
          const u = (e.config && e.config.url) || "?";
          diag.push(u.slice(0, 80) + " → " + (e.response ? "HTTP " + e.response.status : e.message));
          return Promise.reject(e);
        }
      );
    }
    this._fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const u = (typeof input === "string" ? input : input && input.url) || "?";
      return this._fetch(input, init).then(
        (r) => {
          if (!r.ok && u.indexOf("http") === 0) diag.push(u.slice(0, 80) + " → HTTP " + r.status);
          return r;
        },
        (e) => {
          if (u.indexOf("http") === 0) diag.push(u.slice(0, 80) + " → " + e.message);
          throw e;
        }
      );
    };
  }

  get diag() {
    return this.netDiag.slice(-4);
  }

  init() {
    if (typeof TextAliveApp === "undefined") {
      this._emit("error", "TextAlive App API の読み込みに失敗しました。ネットワークを確認してください。");
      return;
    }
    try {
      this.player = new TextAliveApp.Player({
        app: { token: APP_TOKEN },
        mediaElement: this.mediaEl,
      });
    } catch (e) {
      this._emit("error", "Player の初期化に失敗: " + e);
      return;
    }
    this.player.addListener({
      onAppReady: (app) => {
        this.managed = !!app.managed;
        this._emit("appReady", app);
      },
      onAppMediaChange: () => this._emit("mediaChange"),
      onVideoReady: (v) => {
        this._buildSong(v).then(
          (song) => {
            this.song = song;
            this._emit("ready", song);
          },
          (e) => this._emit("error", "歌詞データの変換に失敗: " + e)
        );
      },
      onTimerReady: () => this._emit("timerReady"),
      onStop: () => this._emit("end"),
    });
  }

  /** app.songUrl が無いときだけ自分で曲を読む(ホスト接続時は自動読み込み) */
  loadSong(def) {
    this.lastSong = def;
    this.song = null;
    const opts = def.video ? { video: def.video } : {};
    return this.player.createFromSongUrl(def.url, opts).catch((e) => {
      if (String(e).indexOf("Card data resolver") < 0) throw e;
      // クライアント v0.5.2 は /cards/resolve の 302 を扱えない。事前解決したカード URL へ。
      if (def.card) return this.player.createFromCardUrl(def.card, opts);
      return this._fetch("https://api.textalive.jp/cards/resolve?url=" + encodeURIComponent(def.url), {
        redirect: "follow",
        headers: { "x-ta-app-token": APP_TOKEN },
      }).then((r) => {
        if (!r.ok || !r.url) throw e;
        return this.player.createFromCardUrl(r.url, opts);
      });
    });
  }

  _readings() {
    if (!this.readingsPromise) {
      this.readingsPromise = this._fetch(dataUrl("data/songs/index.json", this.build), { cache: "no-cache" })
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .catch((e) => {
          this.readingDiag = "曲データ一覧の取得に失敗: " + e.message;
          return [];
        });
    }
    return this.readingsPromise;
  }

  async _fixtureFor(code, url) {
    const index = await this._readings();
    const hit = index.find((e) => (code && e.code === code) || (url && e.url && url.indexOf(e.url) >= 0));
    if (!hit) return null;
    const u = dataUrl("data/songs/" + hit.code + ".json", this.build);
    try {
      const r = await this._fetch(u, { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      this.readingDiag = "読みデータの取得に失敗: " + u + " → " + e.message;
      return null;
    }
  }

  async _buildSong(v) {
    const p = this.player;
    let code = null;
    try {
      code = p.data.song.code;
    } catch (e) {}
    const fx = await this._fixtureFor(code, this.lastSong && this.lastSong.url);
    // 読みデータ: 歌詞全体の 1 文字 = 1 読み(空白は数えない)
    const fxChars = [];
    if (fx) for (const ph of fx.phrases) for (const c of ph.chars) fxChars.push(c);
    let cur = 0;
    const take = (ch) => {
      for (let d = 0; d <= 60; d++) {
        const c = fxChars[cur + d];
        if (c && c[0] === ch) {
          cur += d + 1;
          return c[1];
        }
      }
      return null;
    };
    const phrases = [];
    let ph = v.firstPhrase;
    while (ph) {
      const chars = [];
      let c = ph.firstChar;
      while (c) {
        const reading = fx ? take(c.text) : null;
        const s = c.startTime;
        const e = c.endTime && c.endTime > s ? c.endTime : s + 180;
        chars.push({
          text: c.text,
          reading: reading != null ? reading : /^[ぁ-ゖァ-ヶー]$/.test(c.text) ? toHira(c.text) : "",
          s,
          e,
          w: !!(c.parent && c.parent.firstChar === c),
        });
        if (c === ph.lastChar) break;
        c = c.next;
      }
      if (chars.length) phrases.push({ s: ph.startTime, e: ph.endTime, chars });
      ph = ph.next;
    }
    const d = p.data;
    const beats = ((d && (typeof d.getBeats === "function" ? d.getBeats() : d.beats)) || []).map((b) => ({
      t: b.startTime,
      pos: b.position,
      len: b.length,
    }));
    let chords = [];
    try {
      chords = ((d && d.getChords && d.getChords()) || [])
        .filter((x) => x.name && x.name !== "N")
        .map((x) => ({ s: x.startTime, e: x.endTime, name: x.name }));
    } catch (e) {}
    if (!phrases.length) throw new Error("歌詞を取得できませんでした");
    if (fx && !chords.length) {
      chords = fx.chords.map((x) => ({ s: x[0], e: x[1], name: x[2] }));
    }
    return {
      code,
      title: d.song.name,
      artist: d.song.artist.name,
      url: this.lastSong && this.lastSong.url,
      beats,
      chords,
      phrases,
      hasReadings: !!fx,
    };
  }

  getPosition() {
    try {
      return this.player.timer.position;
    } catch (e) {
      return 0;
    }
  }
  isPlaying() {
    try {
      return !!this.player.isPlaying;
    } catch (e) {
      return false;
    }
  }
  async play() {
    this.player.requestPlay();
  }
  pause() {
    this.player.requestPause();
  }
  async seek(ms) {
    this.player.requestMediaSeek(ms);
  }
  /** 楽曲音量は <audio> を直接操作するのが実効(ontology: playback-rate-is-controllable) */
  setVolume(v) {
    try {
      const a = this.mediaEl.querySelector("audio");
      if (a) a.volume = v;
      this.player.volume = Math.round(v * 100);
    } catch (e) {}
  }
}

/**
 * ミクの本体はツインテールである — TextAlive App API 接続版（実曲）
 *
 * ゲーム本体は src/game/ に置き、楽曲は「ソングアダプタ」越しにしか触らない。
 * 擬似曲版（mock.html）と同じコードが、ここでは実曲の拍・歌詞で動く。
 *   拍           → player.data.beats（小節へ束ねて 2 拍目タップ / 最後の拍で確定）
 *   歌詞         → player.video.findChar()（伸ばした髪に流れ込む）
 *   ボーカル音量 → player.getVocalAmplitude()
 */
import { Player } from "textalive-app-api";
import { createGame } from "./game/core.js";
import { createTextAliveSong } from "./song/textalive.js";
import { unlockAudio, audioState } from "./game/audio.js";

export const BUILD = 10;
// 実曲の音量[0-100]。拍の音・効果音が埋もれないところまで下げる
const SONG_VOLUME = 55;
const TOKEN = "VQRxHB1a0q8fVvnm";

// 選曲リスト: マジカルミライ 2025 楽曲コンテスト受賞 6 曲。
// 版数 ID は TextAliveJp 公式サンプル各リポジトリのソースで確認した値
// （ontology/textalive.yaml の contest-songs-2025 / song-load を参照）。
// ホストから曲が指定されているとき（app.songUrl）はそちらが優先され、この一覧は使わない。
const SONGS = [
  { title: "ロンリーラン / 海風太陽", url: "https://piapro.jp/t/CyPO/20250128183915",
    card: "https://api.textalive.jp/cards/Rv6F3kEafnB2ZmKC",
    video: { beatId: 4694280, chordId: 2830735, repetitiveSegmentId: 2946483, lyricId: 67815, lyricDiffId: 20659 } },
  { title: "ストリートライト / 加賀(ネギシャワーP)", url: "https://piapro.jp/t/ULcJ/20250205120202",
    card: "https://api.textalive.jp/cards/mOVlJ15TwK3mGacP",
    video: { beatId: 4694275, chordId: 2830730, repetitiveSegmentId: 2946478, lyricId: 67810, lyricDiffId: 20654 } },
  { title: "アリフレーション / 雨良 Amala", url: "https://piapro.jp/t/SuQO/20250127235813",
    card: "https://api.textalive.jp/cards/tHF561bSn3il7uGQ",
    video: { beatId: 4694276, chordId: 2830731, repetitiveSegmentId: 2946479, lyricId: 67811, lyricDiffId: 20655 } },
  { title: "インフォーマルダイブ / 99piano", url: "https://piapro.jp/t/Ppc9/20241224135843",
    card: "https://api.textalive.jp/cards/H3zE3TtWn8pMU4Qd",
    video: { beatId: 4694277, chordId: 2830732, repetitiveSegmentId: 2946480, lyricId: 67812, lyricDiffId: 20656 } },
  { title: "ハロー、フェルミ。/ ど～ぱみん", url: "https://piapro.jp/t/oTaJ/20250204234235",
    card: "https://api.textalive.jp/cards/ekhSl1QaKHtRrBCW",
    video: { beatId: 4694278, chordId: 2830733, repetitiveSegmentId: 2946481, lyricId: 67813, lyricDiffId: 20657 } },
  { title: "パレードレコード / きさら", url: "https://piapro.jp/t/GCgy/20250202202635",
    card: "https://api.textalive.jp/cards/fAoEqWsPQx12kZsC",
    video: { beatId: 4694279, chordId: 2830734, repetitiveSegmentId: 2946482, lyricId: 67814, lyricDiffId: 20658 } },
];
// ?song=3 で開くと 4 曲目から始まる（検証・共有用。ホスト接続時はホストの曲が優先）
const pick = Number(new URLSearchParams(location.search).get("song"));
const DEV_SONG = SONGS[Number.isInteger(pick) && SONGS[pick] ? pick : 0];

const $ = id => document.getElementById(id);
const setMeta = s => { $("meta").textContent = s; };
const setBuild = () => { $("build").textContent = `build ${BUILD} / snd:${audioState()}`; };

const player = new Player({
  app: { token: TOKEN },
  mediaElement: $("media"),
  vocalAmplitudeEnabled: true,
  valenceArousalEnabled: true,
});
window.textAlivePlayer = player;   // デバッグ・自動テスト用

const song = createTextAliveSong(player);
// 再生の主導権は TextAlive 側にあるので、ゲーム開始＝再生要求にする
song.start = () => { try { player.requestPlay(); } catch (e) {} };

const q = new URLSearchParams(location.search);
const game = createGame($("stage"), song, {
  onState: st => onGameState(st),
  difficulty: q.get("diff") || "normal",
  onFinishSong: r => setMeta(`おつかれさま！ ミク ${r.mikus} 体 / 平均ミク度 ${r.avg} / SCORE ${r.total}`),
});
window.MIKU_GAME = game;
window.MIKU_SONG = song;   // デバッグ・自動テスト用

/**
 * 楽曲の読み込み。曲を替えるたびにゲーム状態を捨てる。
 *
 * createFromSongUrl は api.textalive.jp/cards/resolve が返す 302 に
 * クライアント v0.5.2 が追従できず "Card data resolver is unavailable" で
 * 失敗することがある。各曲は解決済みのカード URL を持っているので、
 * 失敗したらそれを createFromCardUrl に渡す（リダイレクト追従が不要になる）。
 * 詳細: ontology/textalive.yaml の card-data-resolver-unavailable
 */
function loadSong(s) {
  game.reset();
  setMeta("読み込み中……");
  for (const b of document.querySelectorAll("#control button")) b.disabled = true;
  const opts = s.video ? { video: s.video } : undefined;
  player.createFromSongUrl(s.url, opts)
    .catch(e => {
      if (!s.card || String(e).indexOf("Card data resolver") < 0) throw e;
      return player.createFromCardUrl(s.card, opts);
    })
    .catch(e => showDiag("楽曲読み込みに失敗: " + (e && e.message ? e.message : e)));
}

player.addListener({
  onAppReady(app) {
    if (!app.managed) {
      $("control").hidden = false;
      $("start").onclick = () => { unlockAudio(); setBuild(); game.start(); };
      $("auto").onclick = () => { unlockAudio(); game.toggleAuto(); };

      buildSongPicker();
    }
    // ホスト（App Debugger・審査環境）が曲を指定しているときは自動読み込みに任せる
    if (!app.songUrl) loadSong(DEV_SONG);
  },
  onVideoReady() {
    song.rebuild();
    setMeta(`♪ ${player.data.song.name} / ${player.data.song.artist.name}`
          + `　（${song.barCount()} 小節 → ミク ${Math.floor(song.barCount() / 2)} 体ぶん）`);
  },
  onTimerReady() {
    song.rebuild();
    // 楽曲は拍の音を邪魔しない音量に下げる（実曲はここ、擬似曲は songGain 側）
    try { player.volume = SONG_VOLUME; } catch (e) { /* 音量非対応なら諦める */ }
    for (const b of document.querySelectorAll("#control button")) b.disabled = false;
    $("hold").disabled = true;
    setBuild();
  },
  // ホストが再生を握っているとき（app.managed）は、その再生に合わせて進行する
  onPlay() { if (game.state() === "paused") game.resume(); else if (!game.isRunning()) game.start(); },
  onPause() { game.pause(); },
  onStop() { game.pause(); },
  // ホストから曲を差し替えられたときも状態を作り直す
  onAppMediaChange() { game.reset(); setMeta("読み込み中……"); },
});

// 選曲 UI（ホスト未接続時のみ。ホスト接続時は曲の主導権がホストにある）
function buildSongPicker() {
  const sel = $("song");
  for (const [i, s] of SONGS.entries()) {
    const o = document.createElement("option");
    o.value = String(i); o.textContent = s.title; sel.appendChild(o);
  }
  const other = document.createElement("option");
  other.value = "other"; other.textContent = "他の曲を URL で指定……";
  sel.appendChild(other);
  sel.onchange = () => {
    if (sel.value === "other") {
      const url = prompt("TextAlive で利用できる楽曲の URL（piapro / YouTube など）", "");
      if (!url) { sel.value = "0"; return; }
      loadSong({ title: url, url });        // 版数未指定＝最新の解析結果で読み込む
    } else loadSong(SONGS[Number(sel.value)]);
  };
  sel.value = String(SONGS.indexOf(DEV_SONG));
  $("songwrap").hidden = false;
}

// 一時停止 → 再開 / メニューへ戻る
const pauseMenu = $("pausemenu");
$("hold").onclick = () => game.pause();
$("resume").onclick = () => game.resume();
$("tomenu").onclick = () => game.toMenu();
function onGameState(st) {
  pauseMenu.hidden = st !== "paused";
  $("hold").disabled = st !== "playing";
}

$("diff").value = q.get("diff") || "normal";
$("diff").onchange = e => game.setDifficulty(e.target.value);
$("guide").onchange = e => game.setGuide(e.target.checked);

// ---- 起動診断（「読み込み中」で止まったとき、原因を画面に出す） ----------------
const diag = [];
function showDiag(msg) {
  if (!diag.includes(msg)) diag.push(msg);
  $("diag").textContent = "【診断 build " + BUILD + "】\n" + diag.join("\n")
                        + "\nこの表示を開発者に伝えてください";
}
window.addEventListener("error", e => { if (!song.ready()) showDiag("エラー: " + e.message); });
window.addEventListener("unhandledrejection", e => {
  if (!song.ready()) showDiag("エラー: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
});
setTimeout(async () => {
  if (song.ready()) return;
  showDiag("15秒経っても楽曲情報が届きません。疎通チェック中……");
  // api.songle.jp / songle.jp は script として読む前提で CORS ヘッダを返さないため、
  // mode:"cors" だと到達できていても失敗する。到達性だけを見る no-cors で叩く。
  const probes = [
    ["api.textalive.jp", "https://api.textalive.jp/", "cors"],
    ["api.songle.jp", "https://api.songle.jp/v2/api.js", "no-cors"],
    ["songle.jp", "https://songle.jp/lyric_parsers/98.js", "no-cors"],
  ];
  for (const [name, url, mode] of probes) {
    try {
      const r = await fetch(url, { mode });
      showDiag(`${name}: ${mode === "no-cors" ? "到達OK" : "HTTP " + r.status}`);
    } catch { showDiag(`${name}: 接続失敗（ネットワーク遮断/ブロッカー）`); }
  }
  showDiag("すべて成功している場合はトークンのアプリURL登録を確認: " + location.origin);
}, 15000);

setBuild();

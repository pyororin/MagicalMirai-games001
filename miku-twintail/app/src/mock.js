/**
 * 擬似曲版（TextAlive 未接続）。ゲーム本体は接続版とまったく同じものを使う。
 * 通信もトークンも要らないので、手触り・判定・ミク度の検証はこちらで回す。
 */
import { createGame } from "./game/core.js";
import { createMockSong } from "./song/mock.js";
import { unlockAudio, audioState } from "./game/audio.js";

export const BUILD = 8;
const $ = id => document.getElementById(id);
// ?bars=6&bpm=100 で尺やテンポを変えて検証できる（既定は 40 小節 = ミク 20 体）
const q = new URLSearchParams(location.search);
const song = createMockSong({ bpm: Number(q.get("bpm")) || 130, bars: Number(q.get("bars")) || 40 });
const game = createGame($("stage"), song, {
  onFinishSong: r => { $("meta").textContent =
    `おつかれさま！ ミク ${r.mikus} 体 / 平均ミク度 ${r.avg} / SCORE ${r.total}`; },
});
window.MIKU_GAME = game;
window.MIKU_SONG = song;

const setBuild = () => { $("build").textContent = `build ${BUILD} / snd:${audioState()}`; };
$("start").onclick = () => { unlockAudio(); setBuild(); game.start(); $("meta").textContent = song.name; };
$("auto").onclick = () => { unlockAudio(); setBuild(); game.toggleAuto(); };
$("guide").onchange = e => game.setGuide(e.target.checked);
setBuild();

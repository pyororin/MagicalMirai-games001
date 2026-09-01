/**
 * 擬似曲版（TextAlive 未接続）。ゲーム本体は接続版とまったく同じものを使う。
 * 通信もトークンも要らないので、手触り・判定・ミク度の検証はこちらで回す。
 */
import { createGame } from "./game/core.js";
import { createMockSong } from "./song/mock.js";
import { unlockAudio, audioState } from "./game/audio.js";
import * as A from "./game/audio.js";
import { initVolumeUI } from "./ui/volume.js";

export const BUILD = 11;
const $ = id => document.getElementById(id);
// ?bars=6&bpm=100 で尺やテンポを変えて検証できる（既定は 40 小節 = ミク 20 体）
const q = new URLSearchParams(location.search);
const song = createMockSong({ bpm: Number(q.get("bpm")) || 130, bars: Number(q.get("bars")) || 40 });
const game = createGame($("stage"), song, {
  onState: st => onGameState(st),
  difficulty: q.get("diff") || "normal",
  onFinishSong: r => { $("meta").textContent =
    `おつかれさま！ ミク ${r.mikus} 体 / 平均ミク度 ${r.avg} / SCORE ${r.total}`; },
});
window.MIKU_GAME = game;
window.MIKU_SONG = song;

const setBuild = () => { $("build").textContent = `build ${BUILD} / snd:${audioState()}`; };
$("start").onclick = () => { unlockAudio(); setBuild(); game.start(); $("meta").textContent = song.name; };
$("auto").onclick = () => { unlockAudio(); setBuild(); game.toggleAuto(); };

// 一時停止 → 再開 / メニューへ戻る
const pauseMenu = $("pausemenu");
$("hold").onclick = () => game.pause();
$("resume").onclick = () => game.resume();
$("tomenu").onclick = () => game.toMenu();
function onGameState(st) {
  pauseMenu.hidden = st !== "paused";
  $("hold").disabled = st !== "playing";
}


// 音量つまみ（楽曲 / 拍・効果音）。値は localStorage に残る
const volumeUI = initVolumeUI({
  song: $("volSong"), beat: $("volBeat"),
  songOut: $("volSongOut"), beatOut: $("volBeatOut"),
});


// デバッグ・自動テスト用: つまみの値と実際のゲイン
window.MIKU_VOL = () => ({ ...A.getVolumes(),
  songGain: A.songGain && +A.songGain.gain.value.toFixed(3),
  beatGain: A.beatGain && +A.beatGain.gain.value.toFixed(3),
  sfxGain: A.sfxGain && +A.sfxGain.gain.value.toFixed(3) });
$("diff").value = q.get("diff") || "normal";
$("diff").onchange = e => game.setDifficulty(e.target.value);
$("guide").onchange = e => game.setGuide(e.target.checked);
setBuild();

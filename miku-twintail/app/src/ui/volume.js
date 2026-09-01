/**
 * 音量つまみ。楽曲と「拍・効果音」を別々に絞れるようにする。
 *
 * 実曲版では**楽曲だけが WebAudio を通らない**（TextAlive の mediaElement が
 * 直接鳴らす）ので、楽曲のつまみは onSong で外へ渡し、呼び出し側が
 * player.volume に反映する。擬似曲版では onSong を渡さなくてよい。
 *
 * 値は localStorage に覚える。曲や難易度を変えても、リロードしても保たれる。
 */
import { setSongVolume, setBeatVolume, VOL_DEFAULT } from "../game/audio.js";

const KEY = "miku-twintail.volume";

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v.song === "number" && typeof v.beat === "number") return v;
  } catch (e) { /* 保存が読めない環境では既定値でよい */ }
  return { ...VOL_DEFAULT };
}
function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

export function initVolumeUI({ song, beat, songOut, beatOut, onSong } = {}) {
  const v = load();
  const applySong = pct => { setSongVolume(pct); if (onSong) onSong(pct);
                             if (songOut) songOut.textContent = pct; };
  const applyBeat = pct => { setBeatVolume(pct); if (beatOut) beatOut.textContent = pct; };
  if (song) {
    song.value = String(v.song);
    song.oninput = () => { v.song = Number(song.value); applySong(v.song); save(v); };
  }
  if (beat) {
    beat.value = String(v.beat);
    beat.oninput = () => { v.beat = Number(beat.value); applyBeat(v.beat); save(v); };
  }
  applySong(v.song); applyBeat(v.beat);
  /** 楽曲側は player の用意ができてから効くので、あとからもう一度流せるようにする */
  return { reapply: () => { applySong(v.song); applyBeat(v.beat); }, values: () => ({ ...v }) };
}

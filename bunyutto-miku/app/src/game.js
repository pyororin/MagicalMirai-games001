// ぶにゅっとミク — ゲーム本体(描画・入力・進行)。
//
//   片手: スティック(盤面の段)をタップ/なぞる → 音の高さ
//   片手: ミクの顔をピンチ → 口の形(あいうえお)= 音色と表情
// ノーツは「歌詞の1音」。流れてくる段・母音のとおりに、タイミングよく鳴らす。
import { MikuFace } from "./face.js";
import { Voice } from "./voice.js";
import { PinchTracker } from "./pinch.js";
import { Judge, rankOf } from "./judge.js";
import { buildChart, DIFFS } from "./chart.js";
import { rowMidi, midiToHz, ROW_COUNT, ROW_SOLFEGE, NOTE_NAMES } from "./key.js";
import { VOWELS, VOWEL_KANA, GESTURE } from "./vowel.js";
import { SONGS } from "./songs.js";
import { DemoSource } from "./demo.js";
import { TextAliveSource } from "./textalive.js";

export const BUILD = 2;

/* 母音ごとの色。ノーツ・ガイド・結果で共通 */
const VCOL = { a: "#FF7EB6", i: "#FFC93C", u: "#9B7BFF", e: "#38D6CB", o: "#FF6F5E" };
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
const LOOKAHEAD = 2600; // ms。速度 1.0 のとき、画面右端から判定ラインまで
const GRADE_COL = { PERFECT: "#FFE066", GREAT: "#6FE7FF", GOOD: "#8DF59B", FACE: "#FF9BD0", MISS: "#8A93B2" };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.get("demo") === "1";

/* ---------------- 設定の保存(失敗しても動く) ---------------- */
const prefs = { diff: "NORMAL", song: 0, offset: 0, speed: 1, songVol: 0.7, voiceVol: 0.9 };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem("bunyu.prefs") || "{}"));
} catch (e) {}
function savePrefs() {
  try {
    localStorage.setItem("bunyu.prefs", JSON.stringify(prefs));
  } catch (e) {}
}

/* ---------------- 部品 ---------------- */
const canvas = $("stage");
const ctx = canvas.getContext("2d");
const face = new MikuFace();
const faceCanvas = document.createElement("canvas");
face.attach(faceCanvas);
const voice = new Voice();
const pinch = new PinchTracker();
let source = null;

/* ---------------- ゲーム状態 ---------------- */
const G = {
  mode: "loading", // loading | ready | playing | paused | result
  song: null,
  chart: null,
  judge: null,
  tonic: 0,
  midis: rowMidi(0),
  skipTo: 0,
  seekPending: false,
  seekTarget: 0,
  seekDeadline: 0,
  lastPos: 0,
  pos: 0,
  popups: [],
  bursts: [],
  wrongFlash: [],
  weights: { a: 1, i: 0, u: 0, e: 0, o: 0 },
  vowel: "a",
  amount: 0,
  taps: new Map(), // pointerId -> {row}
  activeRow: -1,
  kbVowel: null,
  kbSpace: false,
  firstSound: false,
  hasPinched: false,
  firstTapDone: false,
  result: null,
  diagLine: "",
};
let L = layout(innerWidth, innerHeight);
let dpr = 1;

/* ---------------- レイアウト ---------------- */
function layout(W, H) {
  const o = { W, H };
  const land = W > H * 1.2;
  o.land = land;
  if (!land) {
    const hud = 46;
    const lyric = 38;
    let trackH = Math.max(168, Math.min(Math.round(H * 0.33), 320));
    const trackY = hud + lyric;
    let faceTop = trackY + trackH + 8;
    let side = Math.min(W - 12, H - faceTop - 6);
    if (side < 190) {
      trackH = Math.max(140, trackH - (190 - side));
      faceTop = trackY + trackH + 8;
      side = Math.min(W - 12, H - faceTop - 6);
    }
    o.track = { x: 6, y: trackY, w: W - 12, h: trackH };
    o.face = { x: (W - side) / 2, y: faceTop, s: side };
    o.lyricY = hud + lyric / 2 - 2;
    o.hudH = hud;
  } else {
    const hud = 44;
    const side = Math.min(H - hud - 10, W * 0.46);
    o.face = { x: 8, y: hud + (H - hud - side) / 2, s: side };
    o.track = { x: side + 22, y: hud + 40, w: W - side - 30, h: H - hud - 40 - 10 };
    o.lyricY = hud + 20;
    o.hudH = hud;
  }
  const t = o.track;
  t.rowH = t.h / ROW_COUNT;
  t.hitX = t.x + Math.max(64, Math.min(96, t.w * 0.2));
  o.faceHit = { x: o.face.x - o.face.s * 0.06, y: o.face.y - o.face.s * 0.06, s: o.face.s * 1.12 };
  return o;
}
const inRect = (r, x, y, w, h) => x >= r.x && y >= r.y && x <= r.x + (w ?? r.w) && y <= r.y + (h ?? r.h);

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = innerWidth;
  const H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  L = layout(W, H);
}
addEventListener("resize", resize);
addEventListener("orientationchange", () => setTimeout(resize, 120));

/* ---------------- 入力 ---------------- */
function rowAt(y, prevRow) {
  const t = L.track;
  const f = (y - t.y) / t.rowH; // 上が高い音
  let r = ROW_COUNT - 1 - Math.floor(f);
  r = Math.max(0, Math.min(ROW_COUNT - 1, r));
  if (prevRow != null && prevRow >= 0 && r !== prevRow) {
    // 段の境目付近ではちらつかない(12%のヒステリシス)
    const center = t.y + (ROW_COUNT - 1 - prevRow + 0.5) * t.rowH;
    if (Math.abs(y - center) < t.rowH * (0.5 + 0.12)) return prevRow;
  }
  return r;
}
const rowFreq = (row) => midiToHz(G.midis[row]);

/** 曲の時刻(判定用)。タイミング補正を反映 */
function judgeTime() {
  return (source ? source.getPosition() : 0) - prefs.offset;
}

function curMouth() {
  if (pinch.count >= 2) return { vowel: pinch.state.vowel, amount: pinch.state.amount };
  if (G.kbVowel) return { vowel: G.kbVowel, amount: 1 };
  return { vowel: "a", amount: 0 };
}

/** 顔をピンチしている(2本指が顔にある。PC では ←→↑↓ か Space) */
function pinchActive() {
  return pinch.count >= 2 || !!G.kbVowel || G.kbSpace;
}

/**
 * 声が出るのは「盤面をタップしていて、かつ顔をピンチしているあいだ」だけ。
 * 出始めの瞬間が判定(attack)の瞬間。どちらを先に触っても、そろった時点で鳴る。
 */
function updateSound() {
  const should = G.taps.size > 0 && G.activeRow >= 0 && pinchActive();
  if (should && !voice.on) {
    voice.unlock();
    voice.noteOn(rowFreq(G.activeRow), 0.02);
    G.firstSound = true;
    if (G.mode === "playing" && G.judge) {
      const r = G.judge.attack(judgeTime(), G.activeRow);
      if (r.kind === "wrong") G.wrongFlash.push({ row: G.activeRow, t0: performance.now() });
    }
  } else if (!should && voice.on) {
    voice.noteOff();
  }
}

/** 顔・声・判定に「いまの口の形」を配る */
function applyMouth() {
  const m = curMouth();
  const w = { a: 0, i: 0, u: 0, e: 0, o: 0 };
  if (m.vowel === "a") w.a = 1;
  else {
    w.a = 1 - m.amount;
    w[m.vowel] = m.amount;
  }
  G.target = w;
  const changed = m.vowel !== G.vowel;
  G.vowel = m.vowel;
  G.amount = m.amount;
  voice.setMouth(w, m.amount);
  if (changed && G.judge && G.mode === "playing") G.judge.setVowel(judgeTime(), m.vowel);
  if (m.vowel !== "a" || pinchActive()) G.hasPinched = true;
  updateSound();
}

function tapDown(id, row) {
  voice.unlock();
  if (source && source.kind === "demo") source.bindAudio(voice.ctx);
  G.taps.set(id, { row });
  G.activeRow = row;
  G.firstTapDone = true;
  applyMouth(); // ピンチ中ならここで声が出る(updateSound)
}
function tapMove(id, row) {
  const tp = G.taps.get(id);
  if (!tp || tp.row === row) return;
  tp.row = row;
  if ([...G.taps.keys()].pop() === id) {
    G.activeRow = row;
    if (voice.on) {
      voice.glideTo(rowFreq(row));
      if (G.mode === "playing" && G.judge) G.judge.attack(judgeTime(), row, { slide: true });
    }
  }
}
function tapUp(id) {
  G.taps.delete(id);
  if (!G.taps.size) {
    G.activeRow = -1;
  } else {
    const row = [...G.taps.values()].pop().row;
    G.activeRow = row;
    if (voice.on) voice.glideTo(rowFreq(row));
  }
  updateSound();
}

const owners = new Map(); // pointerId -> 'tap' | 'pinch'
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  voice.unlock();
  const x = e.clientX;
  const y = e.clientY;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (err) {}
  if (inRect(L.track, x, y)) {
    owners.set(e.pointerId, "tap");
    tapDown(e.pointerId, rowAt(y));
  } else if (inRect(L.faceHit, x, y, L.faceHit.s, L.faceHit.s)) {
    owners.set(e.pointerId, "pinch");
    pinch.down(e.pointerId, x, y);
    applyMouth();
  }
});
canvas.addEventListener("pointermove", (e) => {
  const o = owners.get(e.pointerId);
  if (!o) return;
  e.preventDefault();
  if (o === "tap") {
    const tp = G.taps.get(e.pointerId);
    tapMove(e.pointerId, rowAt(e.clientY, tp ? tp.row : null));
  } else {
    pinch.move(e.pointerId, e.clientX, e.clientY);
    applyMouth();
  }
});
function pointerEnd(e) {
  const o = owners.get(e.pointerId);
  if (!o) return;
  owners.delete(e.pointerId);
  if (o === "tap") tapUp(e.pointerId);
  else {
    pinch.up(e.pointerId);
    applyMouth();
  }
}
canvas.addEventListener("pointerup", pointerEnd);
canvas.addEventListener("pointercancel", pointerEnd);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("gesturestart", (e) => e.preventDefault()); // iOS Safari のページ拡大を止める

/* キーボード(PC 確認用): 段 = A S D F G H(低→高) / 顔 = →い ←う ↑お ↓え */
const KEY_ROW = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5 };
const KEY_VOWEL = { ArrowRight: "i", ArrowLeft: "u", ArrowUp: "o", ArrowDown: "e" };
addEventListener(
  "keydown",
  (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    if (e.key === " ") {
      e.preventDefault();
      G.kbSpace = true;
      applyMouth();
    } else if (KEY_VOWEL[e.key]) {
      e.preventDefault();
      G.kbVowel = KEY_VOWEL[e.key];
      applyMouth();
    } else if (KEY_ROW[e.key.toLowerCase()] != null && !e.repeat) {
      const row = KEY_ROW[e.key.toLowerCase()];
      tapDown("kb" + row, row);
    }
  },
  true
);
addEventListener(
  "keyup",
  (e) => {
    if (e.key === " ") {
      G.kbSpace = false;
      applyMouth();
    } else if (KEY_VOWEL[e.key]) {
      if (G.kbVowel === KEY_VOWEL[e.key]) G.kbVowel = null;
      applyMouth();
    } else if (KEY_ROW[e.key.toLowerCase()] != null) {
      tapUp("kb" + KEY_ROW[e.key.toLowerCase()]);
    }
  },
  true
);

/* ---------------- 譜面・進行 ---------------- */
function setChart() {
  if (!G.song) return;
  G.chart = buildChart(G.song, prefs.diff);
  G.tonic = G.chart.tonic;
  G.midis = rowMidi(G.tonic);
  G.judge = new Judge(G.chart.notes);
  G.popups = [];
  G.bursts = [];
  const first = G.chart.notes[0];
  G.skipTo = first ? Math.max(0, first.t - 4200) : 0;
  G.result = null;
}

async function startPlay() {
  voice.unlock();
  if (source.kind === "demo") source.bindAudio(voice.ctx);
  applyVolumes();
  setChart();
  hideOverlay();
  G.mode = "playing";
  G.seekTarget = G.skipTo;
  G.seekPending = G.skipTo > 600;
  G.seekDeadline = performance.now() + 4000;
  pinch.reset();
  for (const id of [...G.taps.keys()]) tapUp(id);
  owners.clear();
  applyMouth();
  G.judge.setVowel(G.skipTo, "a");
  try {
    await source.seek(G.skipTo);
    await source.play();
  } catch (e) {
    showError("再生の開始に失敗: " + e);
  }
}

function finish() {
  if (G.mode !== "playing") return;
  G.mode = "result";
  try {
    source.pause();
  } catch (e) {}
  voice.noteOff();
  const j = G.judge;
  const ratio = j.maxScore ? j.score / j.maxScore : 0;
  G.result = { rank: rankOf(ratio), ratio, score: j.score, maxCombo: j.maxCombo, counts: { ...j.counts }, total: j.notes.length };
  showResult();
}

function pauseGame() {
  if (G.mode !== "playing" || source.managed) return;
  G.mode = "paused";
  try {
    source.pause();
  } catch (e) {}
  voice.noteOff();
  showOverlay("PAUSE", "ひと息つきましょう。", "つづける");
  $("setup").hidden = true;
  $("startBtn").onclick = resumeGame;
  $("quitBtn").hidden = false;
}
async function resumeGame() {
  voice.unlock();
  hideOverlay();
  $("quitBtn").hidden = true;
  G.mode = "playing";
  G.judge.lastTick = null;
  try {
    await source.play();
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGame();
});

/* ---------------- 更新 ---------------- */
let lastFrame = performance.now();
function update(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  // 顔の重みをなめらかに追従
  const tgt = G.target || { a: 1, i: 0, u: 0, e: 0, o: 0 };
  const k = 1 - Math.exp(-dt / 0.05);
  let sum = 0;
  for (const v of VOWELS) {
    G.weights[v] += (tgt[v] - G.weights[v]) * k;
    sum += G.weights[v];
  }
  if (sum > 0) for (const v of VOWELS) G.weights[v] /= sum;

  if (!source) return;
  let pos = source.getPosition();
  if (G.mode === "playing") {
    if (G.seekPending) {
      if (Math.abs(pos - G.seekTarget) < 900 || performance.now() > G.seekDeadline) {
        G.seekPending = false;
        if (G.judge) G.judge.lastTick = null;
      } else pos = G.seekTarget;
    }
    // ホスト接続時にシークで巻き戻されたら、判定を最初からやり直す
    if (source.managed && pos < G.lastPos - 1500) {
      setChart();
    }
    G.lastPos = pos;
    G.pos = pos;
    if (!G.seekPending && G.judge) {
      G.judge.tick(pos - prefs.offset, { down: voice.on, row: G.activeRow, vowel: G.vowel });
      handleEvents();
      const last = G.chart.notes[G.chart.notes.length - 1];
      if (!source.managed) {
        if (last && pos > last.t + last.dur + 3000 && G.judge.done) finish();
        else if (last && pos > last.t + last.dur + 9000) finish();
      }
    }
  } else {
    G.pos = pos;
  }
  G.popups = G.popups.filter((p) => now - p.t0 < p.life);
  G.bursts = G.bursts.filter((b) => now - b.t0 < 520);
  G.wrongFlash = G.wrongFlash.filter((w) => now - w.t0 < 260);
}

function noteY(row) {
  const t = L.track;
  return t.y + (ROW_COUNT - 1 - row + 0.5) * t.rowH;
}
function pxPerMs() {
  const t = L.track;
  return ((t.x + t.w - t.hitX) / LOOKAHEAD) * prefs.speed;
}

function handleEvents() {
  const now = performance.now();
  for (const ev of G.judge.drain()) {
    const n = ev.note;
    const y = noteY(n.row);
    if (ev.kind === "hit") {
      const label = ev.vowelOK ? ev.grade : "かお違い";
      G.popups.push({ text: label, x: L.track.hitX, y: y - L.track.rowH * 0.62, col: GRADE_COL[ev.vowelOK ? ev.grade : "FACE"], t0: now, life: 650 });
      G.bursts.push({ x: L.track.hitX, y, col: VCOL[n.vowel], t0: now });
    } else if (ev.kind === "miss") {
      G.popups.push({ text: "MISS", x: L.track.hitX, y: y - L.track.rowH * 0.62, col: GRADE_COL.MISS, t0: now, life: 600 });
    } else if (ev.kind === "holdEnd" && ev.ratio > 0.5) {
      G.popups.push({ text: ev.ratio > 0.9 ? "HOLD!" : "hold", x: L.track.hitX + 54, y: y - L.track.rowH * 0.62, col: "#FFE066", t0: now, life: 650 });
    }
  }
}

/* ---------------- 描画 ---------------- */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function beatInfo(pos) {
  const bs = G.song && G.song.beats;
  if (!bs || !bs.length) return { phase: 0, pos: 1, pulse: 0 };
  let lo = 0;
  let hi = bs.length - 1;
  let i = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bs[mid].t <= pos) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const b = bs[i];
  const nx = bs[i + 1];
  const dur = nx ? nx.t - b.t : 500;
  const phase = Math.max(0, Math.min(1, (pos - b.t) / dur));
  const strength = b.pos === 1 ? 1 : 0.35;
  return { phase, pos: b.pos, pulse: Math.max(0, 1 - phase * 2.6) * strength };
}

function render(now) {
  const W = L.W;
  const H = L.H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bi = beatInfo(G.pos);
  // 背景: 夜のステージ。拍で呼吸する
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0B1026");
  bg.addColorStop(1, "#151B45");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(L.face.x + L.face.s / 2, L.face.y + L.face.s * 0.45, 10, L.face.x + L.face.s / 2, L.face.y + L.face.s * 0.45, L.face.s * 0.9);
  glow.addColorStop(0, `rgba(57,197,187,${0.22 + bi.pulse * 0.16})`);
  glow.addColorStop(1, "rgba(57,197,187,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  drawTrack(now, bi);
  drawLyrics();
  drawFace(now, bi);
  drawPinchGuides(now);
  drawHud();
  drawPopups(now);
  drawHint();
}

function drawTrack(now, bi) {
  const t = L.track;
  // 盤面
  rr(t.x, t.y, t.w, t.h, 12);
  ctx.fillStyle = "rgba(10,16,48,0.82)";
  ctx.fill();
  ctx.save();
  rr(t.x, t.y, t.w, t.h, 12);
  ctx.clip();
  // 段(レーン)
  for (let r = 0; r < ROW_COUNT; r++) {
    const y = t.y + (ROW_COUNT - 1 - r) * t.rowH;
    ctx.fillStyle = r % 2 ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.075)";
    ctx.fillRect(t.x, y, t.w, t.rowH);
    const active = G.activeRow === r;
    if (active) {
      const g = ctx.createLinearGradient(t.x, 0, t.x + t.w, 0);
      g.addColorStop(0, voice.on ? "rgba(57,197,187,0.55)" : "rgba(57,197,187,0.22)");
      g.addColorStop(1, "rgba(57,197,187,0.06)");
      ctx.fillStyle = g;
      ctx.fillRect(t.x, y, t.w, t.rowH);
    }
    for (const w of G.wrongFlash) {
      if (w.row === r) {
        ctx.fillStyle = `rgba(255,90,90,${0.35 * (1 - (now - w.t0) / 260)})`;
        ctx.fillRect(t.x, y, t.w, t.rowH);
      }
    }
  }
  // スティック(左の首)
  const neckW = t.hitX - t.x - 22;
  const ng = ctx.createLinearGradient(t.x, 0, t.x + neckW, 0);
  ng.addColorStop(0, "rgba(57,197,187,0.20)");
  ng.addColorStop(1, "rgba(57,197,187,0.06)");
  ctx.fillStyle = ng;
  ctx.fillRect(t.x, t.y, neckW, t.h);
  ctx.fillStyle = "rgba(57,197,187,0.7)";
  ctx.fillRect(t.x + neckW - 2, t.y, 2, t.h);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let r = 0; r < ROW_COUNT; r++) {
    const y = noteY(r);
    ctx.font = `700 ${Math.min(16, t.rowH * 0.34)}px ${FONT}`;
    ctx.fillStyle = G.activeRow === r ? "#FFFFFF" : "rgba(232,236,255,0.62)";
    ctx.fillText(ROW_SOLFEGE[r] + (r === 5 ? "↑" : ""), t.x + 10, y);
    // フレットの目印
    ctx.fillStyle = "rgba(57,197,187,0.45)";
    ctx.fillRect(t.x + neckW - 8, y - 1, 6, 2);
  }
  // 判定ライン(受け皿)
  const s = Math.min(t.rowH * 0.82, 46);
  for (let r = 0; r < ROW_COUNT; r++) {
    const y = noteY(r);
    ctx.lineWidth = 2;
    ctx.strokeStyle = G.activeRow === r ? "rgba(255,255,255,0.95)" : "rgba(180,200,255,0.30)";
    rr(t.hitX - s * 0.62, y - s / 2, s * 1.24, s, 9);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(255,255,255,${0.14 + bi.pulse * 0.22})`;
  ctx.fillRect(t.hitX - 1, t.y, 2, t.h);

  // ノーツ
  if (G.judge && (G.mode === "playing" || G.mode === "paused")) {
    const pms = pxPerMs();
    const pos = G.pos - prefs.offset;
    const notes = G.judge.notes;
    // 奥(右)から手前へ描くと、手前のノーツが上に重なる
    const vis = [];
    for (let k = G.judge.cursor; k < notes.length; k++) {
      const n = notes[k];
      const x = t.hitX + (n.t - pos) * pms;
      if (x - 40 > t.x + t.w + 20) break;
      vis.push(n);
    }
    // 判定済みで確定待ちの先頭より前(確定済み)は cursor で飛ばしているが、
    // 余韻の見える1つ前まで描く
    for (let k = vis.length - 1; k >= 0; k--) drawNote(vis[k], pos, pms, s, now);
  }
  ctx.restore();

  // バースト
  for (const b of G.bursts) {
    const u = (now - b.t0) / 520;
    ctx.fillStyle = b.col;
    ctx.globalAlpha = 1 - u;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2 + 0.3;
      const rad = 10 + u * 34;
      const px = Math.round(b.x + Math.cos(ang) * rad);
      const py = Math.round(b.y + Math.sin(ang) * rad);
      const q = Math.max(2, Math.round(5 * (1 - u)));
      ctx.fillRect(px - q / 2, py - q / 2, q, q);
    }
    ctx.globalAlpha = 1;
  }
}

function drawNote(n, pos, pms, s, now) {
  const t = L.track;
  const y = noteY(n.row);
  const x = t.hitX + (n.t - pos) * pms;
  const col = VCOL[n.vowel];
  const done = n.res;
  const missed = done && done.grade === "MISS";
  const w = s * 1.24;
  // 長音のしっぽ
  if (n.hold) {
    const x1 = t.hitX + (n.t + n.dur - pos) * pms;
    const xs = Math.max(x, t.hitX);
    if (x1 > xs && !missed) {
      const hh = s * 0.5;
      ctx.globalAlpha = n.holding ? 1 : 0.85;
      ctx.fillStyle = n.holding ? col : col + "AA";
      rr(xs, y - hh / 2, x1 - xs, hh, hh / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(11,16,38,0.9)";
      ctx.lineWidth = 2;
      rr(xs, y - hh / 2, x1 - xs, hh, hh / 2);
      ctx.stroke();
      // 「ー」の目印
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      for (let px = xs + 12; px < x1 - 6; px += 14) ctx.fillRect(px, y - 1, 7, 2);
    }
  }
  if (done && !missed && !n.hold) return; // 当たった短いノーツは、バーストに任せて消す
  if (done && !missed && n.hold && x < t.hitX - w) return;
  if (missed && x < t.hitX - w * 1.6) return;
  const hx = n.holding ? t.hitX : x;
  if (hx + w / 2 < t.x) return;
  ctx.save();
  if (missed) ctx.globalAlpha = 0.35;
  const near = Math.max(0, 1 - Math.abs(n.t - pos) / 700);
  if (!done && near > 0) {
    ctx.shadowColor = col;
    ctx.shadowBlur = 10 * near;
  }
  rr(hx - w / 2, y - s / 2, w, s, 9);
  ctx.fillStyle = missed ? "#6A7090" : col;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#0B1026";
  ctx.stroke();
  // ハイライト
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  rr(hx - w / 2 + 3, y - s / 2 + 3, w - 6, s * 0.32, 6);
  ctx.fill();
  // 母音のかな
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.round(s * 0.52)}px ${FONT}`;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(11,16,38,0.85)";
  ctx.strokeText(VOWEL_KANA[n.vowel], hx, y + 1);
  ctx.fillStyle = "#fff";
  ctx.fillText(VOWEL_KANA[n.vowel], hx, y + 1);
  // ジェスチャの矢印(小さな三角)
  drawGestureArrows(n.vowel, hx, y, w, s);
  ctx.restore();
}

/** ピンチの向きを示す三角。外向き=ひろげる、内向き=つぼめる。あ は無し */
function drawGestureArrows(v, cx, cy, w, h) {
  const g = GESTURE[v];
  if (!g.axis) return;
  ctx.fillStyle = "rgba(11,16,38,0.92)";
  const a = Math.max(4, h * 0.13);
  const tri = (x, y, dx, dy) => {
    // 頂点が (x,y)、向きが (dx,dy) の小さな三角
    ctx.beginPath();
    ctx.moveTo(x + dx * a, y + dy * a);
    ctx.lineTo(x - dy * a * 0.9 - dx * a * 0.2, y + dx * a * 0.9 - dy * a * 0.2);
    ctx.lineTo(x + dy * a * 0.9 - dx * a * 0.2, y - dx * a * 0.9 - dy * a * 0.2);
    ctx.closePath();
    ctx.fill();
  };
  const sgn = g.dir === "out" ? 1 : -1;
  if (g.axis === "h") {
    const ex = w / 2 - a - 3;
    tri(cx - ex, cy, -sgn, 0);
    tri(cx + ex, cy, sgn, 0);
  } else {
    const ey = h / 2 - a - 2;
    tri(cx, cy - ey, 0, -sgn);
    tri(cx, cy + ey, 0, sgn);
  }
}

function drawLyrics() {
  const song = G.song;
  if (!song) return;
  const pos = G.pos;
  const ph = song.phrases;
  let cur = null;
  for (const p of ph) {
    if (pos >= p.s - 1800 && pos <= p.e + 600) {
      cur = p;
      break;
    }
    if (p.s > pos) break;
  }
  if (!cur) return;
  const chars = cur.chars;
  const text = chars.map((c) => c.text).join("");
  let size = L.land ? 20 : 22;
  ctx.font = `700 ${size}px ${FONT}`;
  const maxW = (L.land ? L.track.w : L.W) - 24;
  const mw = ctx.measureText(text).width;
  if (mw > maxW) {
    size = Math.max(11, Math.floor((size * maxW) / mw));
    ctx.font = `700 ${size}px ${FONT}`;
  }
  const total = ctx.measureText(text).width;
  const cx = L.land ? L.track.x + L.track.w / 2 : L.W / 2;
  let x = cx - total / 2;
  const y = L.lyricY;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const c of chars) {
    const wd = ctx.measureText(c.text).width;
    const sung = pos >= c.s;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(11,16,38,0.8)";
    ctx.strokeText(c.text, x, y);
    ctx.fillStyle = sung ? "#7CE3D8" : "rgba(232,236,255,0.78)";
    ctx.fillText(c.text, x, y);
    x += wd;
  }
}

function drawFace(now, bi) {
  const f = L.face;
  // まばたきも一瞬でパチッと切り替えず、閉じて開く動きにする(口の形を作っているあいだはしない)
  const bp = now % 3600;
  const blink = bp < 170 ? Math.sin((Math.PI * bp) / 170) * G.weights.a : 0;
  face.render({ w: G.weights, blink, beat: G.mode === "playing" ? bi.pulse : 0, t: now / 1000, singing: voice.on });
  // 320×320 の細かいドット絵を滑らかに縮小して描く(ドットが一見わからない細かさ)
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(faceCanvas, f.x, f.y, f.s, f.s);
  // 口の形に合わせたガイド枠(ピンチ可能な範囲)
  ctx.save();
  ctx.setLineDash([6, 7]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = G.hasPinched ? "rgba(57,197,187,0.20)" : "rgba(57,197,187,0.55)";
  rr(f.x, f.y, f.s, f.s, 22);
  ctx.stroke();
  ctx.restore();
}

function drawPinchGuides(now) {
  const pts = [...pinch.pts.values()];
  if (!pts.length) return;
  ctx.save();
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = VCOL[G.vowel];
    ctx.stroke();
  }
  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = VCOL[G.vowel] + "CC";
    ctx.stroke();
    // 母音のかなを中央に
    ctx.font = `800 ${Math.round(L.face.s * 0.12)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(11,16,38,0.8)";
    ctx.strokeText(VOWEL_KANA[G.vowel], mx, my - 28);
    ctx.fillStyle = VCOL[G.vowel];
    ctx.fillText(VOWEL_KANA[G.vowel], mx, my - 28);
  }
  ctx.restore();
}

function drawHud() {
  const j = G.judge;
  ctx.textBaseline = "middle";
  // 進行バー
  if (G.chart && G.chart.notes.length) {
    const last = G.chart.notes[G.chart.notes.length - 1];
    const u = Math.max(0, Math.min(1, (G.pos - G.skipTo) / (last.t + last.dur - G.skipTo)));
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, 0, L.W, 4);
    ctx.fillStyle = "#33BDB2";
    ctx.fillRect(0, 0, L.W * u, 4);
  }
  const y = 26;
  ctx.textAlign = "right";
  ctx.font = `800 24px ${FONT}`;
  ctx.fillStyle = "#fff";
  ctx.fillText(String(j ? j.score : 0).padStart(7, "0"), L.W - 12, y);
  ctx.textAlign = "left";
  ctx.font = `700 12px ${FONT}`;
  ctx.fillStyle = "rgba(232,236,255,0.7)";
  if (G.song) {
    let ttl = "♪ " + G.song.title + (G.song.artist ? " / " + G.song.artist : "");
    const maxW = L.W - 190;
    while (ctx.measureText(ttl).width > maxW && ttl.length > 6) ttl = ttl.slice(0, -2);
    ctx.fillText(ttl, 54, 17);
  }
  if (j && j.combo > 1) {
    ctx.font = `800 15px ${FONT}`;
    ctx.fillStyle = "#FFE066";
    ctx.fillText(j.combo + " COMBO", 54, 36);
  } else if (G.chart) {
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = "rgba(232,236,255,0.5)";
    ctx.fillText(`${prefs.diff}  key=${NOTE_NAMES[G.tonic]}  ${G.chart.notes.length}notes`, 54, 36);
  }
}

function drawPopups(now) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of G.popups) {
    const u = (now - p.t0) / p.life;
    ctx.globalAlpha = 1 - u * u;
    ctx.font = `800 ${p.text.length > 5 ? 13 : 15}px ${FONT}`;
    const y = p.y - u * 14;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(11,16,38,0.85)";
    ctx.strokeText(p.text, p.x, y);
    ctx.fillStyle = p.col;
    ctx.fillText(p.text, p.x, y);
  }
  ctx.globalAlpha = 1;
}

/** はじめての操作ガイド */
function drawHint() {
  if (G.mode !== "playing" && G.mode !== "ready") return;
  if (G.firstSound) return;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 13px ${FONT}`;
  const put = (text, x, y) => {
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(11,16,38,0.9)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#7CE3D8";
    ctx.fillText(text, x, y);
  };
  const f = L.face;
  put("盤面を押したまま、ここを2本指でピンチ → 声が出る", f.x + f.s / 2, f.y + f.s - 14);
  if (!G.firstTapDone) {
    const t = L.track;
    put("段をタップ/なぞる → 音の高さ", t.x + t.w / 2 + 20, t.y + t.h - 12);
  }
}

/* ---------------- ループ ---------------- */
let loopErrors = 0;
function frame(now) {
  requestAnimationFrame(frame); // 先に次を予約(例外で止まらないように)
  try {
    update(now);
    render(now);
    updateBadge();
  } catch (e) {
    if (loopErrors++ < 3) showError("描画ループで例外: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n") : e));
  }
}

/* ---------------- 画面(DOM) ---------------- */
function showOverlay(title, text, btn) {
  $("ovTitle").textContent = title;
  $("ovText").textContent = text;
  $("startBtn").textContent = btn || "スタート";
  $("result").hidden = true;
  $("setup").hidden = false;
  $("overlay").style.display = "grid";
}
function hideOverlay() {
  $("overlay").style.display = "none";
}
function showError(msg) {
  $("ovTitle").textContent = "ERROR";
  $("ovText").textContent = "";
  const e = $("ovErr");
  e.hidden = false;
  const d = source && source.diag ? source.diag : [];
  e.textContent = String(msg) + "\n[build " + BUILD + "]" + (d.length ? "\n--- 失敗した通信 ---\n" + d.join("\n") : "");
  $("overlay").style.display = "grid";
}
function updateBadge() {
  const b = $("build");
  const mismatch = window.BUNYU_BUILD && window.BUNYU_BUILD !== BUILD;
  b.textContent =
    "build " + BUILD + (mismatch ? " (index " + window.BUNYU_BUILD + " ≠ キャッシュ混在?)" : "") + " / snd:" + voice.state +
    (voice.ctx ? " lat:" + voice.outputLatencyMs + "ms" : "") + (DEMO ? " / DEMO" : "");
  b.style.color = mismatch ? "#FF9BAA" : "";
}

function showResult() {
  const r = G.result;
  $("ovTitle").textContent = "RESULT";
  $("ovText").textContent = "";
  $("setup").hidden = false;
  $("result").hidden = false;
  $("rRank").textContent = r.rank;
  $("rScore").textContent = String(r.score).padStart(7, "0");
  const c = r.counts;
  $("rDetail").textContent =
    `PERFECT ${c.PERFECT}  GREAT ${c.GREAT}  GOOD ${c.GOOD}  MISS ${c.MISS}\nかお違い ${c.FACE}  最大コンボ ${r.maxCombo}  達成率 ${Math.round(r.ratio * 100)}%`;
  $("startBtn").textContent = "もういちど";
  $("startBtn").onclick = startPlay;
  $("quitBtn").hidden = true;
  $("overlay").style.display = "grid";
}

function buildHowTo() {
  const box = $("howto");
  box.textContent = "";
  const items = [
    ["a", "2本指で\nさわる", "あ"],
    ["i", "横に\nひろげる", "い"],
    ["u", "横から\nおさえる", "う"],
    ["e", "たてに\nつぶす", "え"],
    ["o", "たてに\nひろげる", "お"],
  ];
  const arrows = { a: "●", i: "◀ ▶", u: "▶ ◀", e: "▼ ▲", o: "▲ ▼" };
  for (const [v, label, kana] of items) {
    const card = document.createElement("div");
    card.className = "hw";
    const c = document.createElement("canvas");
    const f = new MikuFace();
    f.attach(c);
    const w = { a: 0, i: 0, u: 0, e: 0, o: 0 };
    w[v] = 1;
    f.render({ w, blink: 0, beat: 0, t: 0 });
    const k = document.createElement("div");
    k.className = "hk";
    k.style.background = VCOL[v];
    k.textContent = kana;
    const ar = document.createElement("div");
    ar.className = "ha";
    ar.textContent = arrows[v];
    const lb = document.createElement("div");
    lb.className = "hl";
    lb.textContent = label;
    card.append(c, k, ar, lb);
    box.appendChild(card);
  }
}

function buildControls() {
  const pick = $("songPick");
  SONGS.forEach((s, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = s.title;
    pick.appendChild(o);
  });
  pick.value = String(Math.min(prefs.song, SONGS.length - 1));
  pick.addEventListener("change", () => {
    prefs.song = +pick.value;
    savePrefs();
    loadSelected();
  });
  document.querySelectorAll("[data-diff]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.diff === prefs.diff));
    b.addEventListener("click", () => {
      prefs.diff = b.dataset.diff;
      savePrefs();
      document.querySelectorAll("[data-diff]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      if (G.song) {
        setChart();
        $("chartInfo").textContent = chartInfo();
      }
    });
  });
  const bind = (id, key, fmt, apply) => {
    const el = $(id);
    el.value = String(prefs[key]);
    const out = $(id + "V");
    const upd = () => {
      prefs[key] = +el.value;
      out.textContent = fmt(prefs[key]);
      savePrefs();
      if (apply) apply();
    };
    el.addEventListener("input", upd);
    out.textContent = fmt(prefs[key]);
  };
  bind("offset", "offset", (v) => (v > 0 ? "+" : "") + v + "ms");
  bind("speed", "speed", (v) => v.toFixed(2) + "×");
  bind("songVol", "songVol", (v) => Math.round(v * 100) + "%", applyVolumes);
  bind("voiceVol", "voiceVol", (v) => Math.round(v * 100) + "%", applyVolumes);
  $("quitBtn").onclick = () => {
    $("quitBtn").hidden = true;
    G.mode = "ready";
    try {
      source.pause();
    } catch (e) {}
    showOverlay("READY", "曲と難易度を選んでスタート。", "スタート");
    $("startBtn").onclick = startPlay;
  };
  $("pauseBtn").addEventListener("click", pauseGame);
  $("startBtn").onclick = startPlay;
}

function applyVolumes() {
  voice.setVolume(prefs.voiceVol);
  if (source) source.setVolume(prefs.songVol);
}

function chartInfo() {
  if (!G.chart) return "";
  const n = G.chart.notes;
  const secs = n.length > 1 ? (n[n.length - 1].t - n[0].t) / 1000 : 1;
  const hold = n.filter((x) => x.hold).length;
  return `${n.length}ノーツ(長音${hold}) ・ ${(n.length / secs).toFixed(1)}音/秒 ・ 調: ${NOTE_NAMES[G.tonic]}メジャー系ペンタ`;
}

/* ---------------- 起動 ---------------- */
function onSongReady(song) {
  G.song = song;
  setChart();
  G.mode = "ready";
  G.songReady = true;
  updateStartEnabled();
  $("ovTitle").textContent = "READY";
  $("ovText").textContent = `♪ ${song.title}${song.artist ? " / " + song.artist : ""}`;
  $("chartInfo").textContent = chartInfo() + (song.hasReadings === false ? "(読みデータ無し: 漢字は母音を仮割り当て)" : "");
  $("ovErr").hidden = true;
}

/** TextAlive は onTimerReady(再生できる状態)まで待つ。デモは曲データが来ればよい */
function updateStartEnabled() {
  $("startBtn").disabled = !(G.songReady && (source.kind === "demo" || G.timerReady));
}

async function loadSelected() {
  const def = SONGS[+$("songPick").value];
  G.mode = "loading";
  G.song = null;
  G.songReady = false;
  G.timerReady = false;
  $("startBtn").disabled = true;
  $("ovTitle").textContent = "LOADING…";
  $("ovText").textContent = "楽曲を読み込んでいます: " + def.url;
  $("chartInfo").textContent = "";
  $("ovErr").hidden = true;
  try {
    if (source.kind === "demo") onSongReady(await source.loadSong(def));
    else await source.loadSong(def); // 完了は onVideoReady → ready イベント
  } catch (e) {
    showError("楽曲の読み込みに失敗: " + e);
  }
}

function boot() {
  resize();
  buildHowTo();
  buildControls();
  requestAnimationFrame(frame);
  window.BUNYU = {
    BUILD,
    G,
    prefs,
    voice,
    pinch,
    layout: () => L,
    source: () => source,
    start: startPlay,
    snapshot: () => ({
      mode: G.mode,
      pos: G.pos,
      score: G.judge && G.judge.score,
      combo: G.judge && G.judge.combo,
      counts: G.judge && G.judge.counts,
      vowel: G.vowel,
      amount: G.amount,
      row: G.activeRow,
      notes: G.judge && G.judge.notes.length,
      tonic: G.tonic,
      voiceOn: voice.on,
      voiceNodes: voice.log.createdNodes,
      noteOns: voice.log.noteOn,
      weights: { ...G.weights },
      mouth: voice.lastMouth,
    }),
  };

  if (DEMO) {
    $("demoLink").hidden = true;
    source = new DemoSource(BUILD);
    $("ovText").textContent = "デモモード: TextAlive に接続せず、合成した伴奏で遊びます。";
    loadSelected();
    return;
  }
  source = new TextAliveSource({ build: BUILD, mediaEl: $("media") });
  source.on("error", (m) => showError(m));
  source.on("appReady", (app) => {
    if (app.managed) {
      // ホスト(TextAlive App Debugger 等)が再生・曲を管理する。自前の選曲・開始 UI は隠す
      $("setup").hidden = true;
      $("pauseBtn").hidden = true;
      $("startBtn").hidden = true;
    }
    if (!app.songUrl) loadSelected();
  });
  source.on("mediaChange", () => {
    G.song = null;
    G.songReady = false;
    G.timerReady = false;
    G.mode = "loading";
  });
  source.on("ready", (song) => {
    onSongReady(song);
    if (source.managed) {
      // ホスト管理: 再生が始まったら判定を回す
      hideOverlay();
      G.mode = "playing";
      G.seekPending = false;
      applyVolumes();
      G.judge.setVowel(0, "a");
    }
  });
  source.on("timerReady", () => {
    G.timerReady = true;
    updateStartEnabled();
  });
  source.on("end", () => {
    if (G.mode === "playing" && !source.managed) finish();
  });
  source.init();
  // 15秒たっても読み込みが進まなければ、通信の失敗を表示して原因を切り分けられるようにする
  setTimeout(() => {
    if (G.mode === "loading") showError("楽曲の読み込みが進みません(15秒)。ネットワーク/トークン/曲URLを確認してください。");
  }, 15000);
}

boot();

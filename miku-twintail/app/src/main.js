/**
 * ミクの本体はツインテールである — P1: TextAlive App API 接続版
 *
 * 擬似データ層（prototype/index.html）を TextAlive App API の実データに差し替えたもの。
 *   ビート           → player.findBeat()
 *   歌唱区間・歌詞   → player.video.findPhrase() / findChar()
 *   ボーカル音量     → player.getVocalAmplitude()
 *   サビ（自動判定） → player.findChorus()
 */
import { Player } from "textalive-app-api";

const TOKEN = "VQRxHB1a0q8fVvnm";

// 開発用のデフォルト曲: マジカルミライ 2025 課題曲「ロンリーラン / 海風太陽」
// （公式サンプル textalive-app-basic と同じ楽曲・版数。ホスト接続時は app.songUrl が優先される）
const DEV_SONG = {
  url: "https://piapro.jp/t/CyPO/20250128183915",
  video: {
    beatId: 4694280,
    chordId: 2830735,
    repetitiveSegmentId: 2946483,
    lyricId: 67815,
    lyricDiffId: 20659,
  },
};

// ---- TextAlive Player ----------------------------------------------------------
const player = new Player({
  app: { token: TOKEN },
  mediaElement: document.querySelector("#media"),
  vocalAmplitudeEnabled: true,
  valenceArousalEnabled: true,
});

let ready = false, maxAmp = 1;
window.textAlivePlayer = player;   // デバッグ・自動テスト用

player.addListener({
  onAppReady(app) {
    if (!app.managed) {
      document.getElementById("control").hidden = false;
      document.getElementById("play").onclick = () => player.video && player.requestPlay();
      document.getElementById("pause").onclick = () => player.video && player.requestPause();
      document.getElementById("rewind").onclick = () => player.video && player.requestMediaSeek(0);
    }
    if (!app.songUrl) player.createFromSongUrl(DEV_SONG.url, { video: DEV_SONG.video });
  },
  onVideoReady() {
    document.getElementById("meta").textContent =
      `♪ ${player.data.song.name} / ${player.data.song.artist.name}`;
  },
  onTimerReady() {
    maxAmp = player.getMaxVocalAmplitude() || 1;
    ready = true;
    for (const b of document.querySelectorAll("#control button")) b.disabled = false;
  },
});

// ---- 楽曲データ層（モックの擬似層と同じインタフェースを実データで提供） --------
const posMs = () => (player.timer ? player.timer.position : 0);
function onBeat(ms) {
  const b = player.findBeat(ms);
  if (!b) return false;
  const p = b.progress(ms);
  return p < 0.25 || p > 0.75;
}
const vocalActive = ms => ready && !!(player.video && player.video.findPhrase(ms));
const vocalAmp = ms => ready ? Math.min(1, player.getVocalAmplitude(ms) / maxAmp * 1.6) : 0;
const findCharText = ms => {
  const c = player.video && player.video.findChar(ms);
  return c ? c.text : null;
};

// ---- 演奏エフェクト（タップ＝合いの手） ---------------------------------------
// ホールド中は 8 分音符ごとにコードトーンのプラック（曲の和音に必ずハモる）、
// リリースでマラカス。拍に合ったリリースはタンバリンの「シャン」に格上げ。
let ac = null, noiseBuf = null;
function ensureAudio() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === "suspended") ac.resume();
}
const NOTE = st => 440 * Math.pow(2, st / 12);
const PC = { C: 3, "C#": 4, Db: 4, D: 5, "D#": 6, Eb: 6, E: 7, F: 8, "F#": 9, Gb: 9,
             G: 10, "G#": 11, Ab: 11, A: 0, "A#": 1, Bb: 1, B: 2 };
// A4=0 の半音オフセットで現在のコードトーンを返す（コード不明時は A マイナーペンタ）
function chordTones(ms) {
  const c = ready && player.findChord(ms);
  const m = c && c.name && c.name.match(/^([A-G][#b]?)(m(?!aj))?/);
  if (!m || !(m[1] in PC)) return [0, 3, 7, 12];
  const root = PC[m[1]] - 12;
  return [root, root + (m[2] ? 3 : 4), root + 7, root + 12];
}
function pluck(step, ms) {
  ensureAudio();
  const tones = chordTones(ms);
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = "triangle"; o.frequency.value = NOTE(tones[step % tones.length] + 12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.02 + 0.06 * vocalAmp(ms), t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.2);
}
function shaker(accent) {
  ensureAudio();
  const t = ac.currentTime;
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 5000;
  const g = ac.createGain();
  g.gain.setValueAtTime(accent ? 0.22 : 0.1, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (accent ? 0.22 : 0.12));
  s.connect(hp); hp.connect(g); g.connect(ac.destination); s.start(t);
  if (accent) for (const [f, dt] of [[6200, 0], [8400, 0.05]]) {   // タンバリンの鈴
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = "sine"; o.frequency.value = f;
    og.gain.setValueAtTime(0.0001, t + dt);
    og.gain.exponentialRampToValueAtTime(0.08, t + dt + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.15);
    o.connect(og); og.connect(ac.destination); o.start(t + dt); o.stop(t + dt + 0.25);
  }
}
let holdTimer = null, lastSlot = null, toneStep = 0;
function slotOf(ms) {
  const b = ready && player.findBeat(ms);
  if (!b) return null;
  return b.startTime * 2 + (b.progress(ms) >= 0.5 ? 1 : 0);   // 8 分音符スロット
}
function startHold() {
  lastSlot = slotOf(posMs()); toneStep = 0;
  holdTimer = setInterval(() => {
    const ms = posMs(), s = slotOf(ms);
    if (s !== null && s !== lastSlot) { lastSlot = s; if (vocalActive(ms)) pluck(toneStep++, ms); }
  }, 25);
}
function stopHold() { if (holdTimer) { clearInterval(holdTimer); holdTimer = null; } }

// ---- お題（日常に存在する物。造形は Canvas 直描き） ----------------------------
const cv = document.getElementById("stage"), cx2d = cv.getContext("2d");
const OBJECTS = [
  { name: "タイヤホイール", cx: 450, cy: 370, hw: 110, hh: 110, draw(g) {
      g.fillStyle = "#222"; disc(g, this.cx, this.cy, 110);
      g.fillStyle = "#f2c519"; disc(g, this.cx, this.cy, 79);
      g.strokeStyle = "#c79d0a"; g.lineWidth = 10;
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2;
        g.beginPath(); g.moveTo(this.cx, this.cy);
        g.lineTo(this.cx + Math.cos(a) * 66, this.cy + Math.sin(a) * 66); g.stroke(); }
      g.fillStyle = "#e6e6e6"; disc(g, this.cx, this.cy, 18); } },
  { name: "マグカップ", cx: 450, cy: 380, hw: 80, hh: 95, draw(g) {
      g.strokeStyle = "#b8895a"; g.lineWidth = 16;
      g.beginPath(); g.arc(this.cx + 92, this.cy, 42, -1.2, 1.2); g.stroke();
      g.fillStyle = "#d9a06b"; roundRect(g, this.cx - 80, this.cy - 95, 160, 190, 18);
      g.fillStyle = "#7a4f2b"; g.beginPath();
      g.ellipse(this.cx, this.cy - 88, 72, 14, 0, 0, 7); g.fill(); } },
  { name: "炊飯器", cx: 450, cy: 395, hw: 105, hh: 85, draw(g) {
      g.fillStyle = "#e9edf0"; roundRect(g, this.cx - 105, this.cy - 85, 210, 170, 34);
      g.fillStyle = "#c6ced4"; roundRect(g, this.cx - 105, this.cy - 85, 210, 46, 22);
      g.fillStyle = "#39c5bb"; disc(g, this.cx, this.cy + 20, 12);
      g.fillStyle = "#9aa6ad"; roundRect(g, this.cx - 30, this.cy - 96, 60, 14, 6); } },
  { name: "ペットボトル", cx: 450, cy: 385, hw: 55, hh: 115, draw(g) {
      g.fillStyle = "#bfe3f2"; roundRect(g, this.cx - 55, this.cy - 75, 110, 190, 22);
      g.fillStyle = "#bfe3f2"; g.beginPath();
      g.moveTo(this.cx - 55, this.cy - 70); g.lineTo(this.cx - 22, this.cy - 108);
      g.lineTo(this.cx + 22, this.cy - 108); g.lineTo(this.cx + 55, this.cy - 70);
      g.closePath(); g.fill();
      g.fillStyle = "#ffffff"; roundRect(g, this.cx - 44, this.cy - 20, 88, 56, 6);
      g.fillStyle = "#2f89a8"; roundRect(g, this.cx - 20, this.cy - 130, 40, 24, 5); } },
];
let objIdx = 0;
const obj = () => OBJECTS[objIdx];
function disc(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); }
document.getElementById("swap").onclick = () => {
  objIdx = (objIdx + 1) % OBJECTS.length; ropes.length = 0; result.textContent = "";
};

// ---- 髪（Verlet ロープ、枯れた技術） ------------------------------------------
const ropes = [];
let stroke = null;

function makeRope(drawnPts, beatFit, chars, tapOnBeat = false, relOnBeat = false) {
  const pts = resample(drawnPts, Math.max(10, Math.min(26, Math.floor(polyLen(drawnPts) / 12))));
  const nodes = pts.map(p => ({ x: p.x, y: p.y, px: p.x, py: p.y }));
  const segLens = [];
  for (let i = 1; i < nodes.length; i++) segLens.push(dist(nodes[i - 1], nodes[i]));
  // 付け根の向き: 頭（お題）の左右から外側上方向に立ち上がる
  const sign = drawnPts[0].x >= obj().cx ? 1 : -1;
  const od = Math.hypot(0.85, 0.55);
  const outDir = { x: sign * 0.85 / od, y: -0.55 / od };
  return { nodes, segLens, drawn: drawnPts, beatFit, len: polyLen(drawnPts),
           seed: Math.random() * 7, outDir, tapOnBeat, relOnBeat,
           chars: chars.length ? chars : [..."ツインテール"] };
}
function stepRope(r, t) {
  const wind = vocalAmp(posMs());
  for (let i = 1; i < r.nodes.length; i++) {
    const n = r.nodes[i];
    const vx = (n.x - n.px) * 0.975, vy = (n.y - n.py) * 0.975;
    n.px = n.x; n.py = n.y;
    n.x += vx + Math.sin(t * 2.2 + i * 0.45 + r.seed) * wind * 0.55; // 声が髪を揺らす（控えめ）
    n.y += vy + 0.35;
  }
  for (let k = 0; k < 4; k++) {
    for (let i = 1; i < r.nodes.length; i++) {
      const a = r.nodes[i - 1], b = r.nodes[i], L = r.segLens[i - 1];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
      const diff = (d - L) / d;
      if (i === 1) { b.x -= dx * diff; b.y -= dy * diff; }
      else { a.x += dx * diff * .5; a.y += dy * diff * .5; b.x -= dx * diff * .5; b.y -= dy * diff * .5; }
    }
  }
  // 立ち上がり剛性: 根元の数節は外側上方向に張り、その先は重力で垂れる
  let cum = 0;
  const K = [0.6, 0.35, 0.15];
  for (let i = 1; i <= Math.min(3, r.nodes.length - 1); i++) {
    cum += r.segLens[i - 1];
    const n = r.nodes[i], k = K[i - 1];
    n.x += (r.nodes[0].x + r.outDir.x * cum - n.x) * k;
    n.y += (r.nodes[0].y + r.outDir.y * cum - n.y) * k;
  }
}

// ---- ミクのツインテール描画 -----------------------------------------------------
function tailOutline(r, t) {
  const n = r.nodes, m = n.length, L = [], R = [];
  const wRoot = 22;
  for (let i = 0; i < m; i++) {
    const ti = i / (m - 1);
    const a = n[Math.max(0, i - 1)], b = n[Math.min(m - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1e-6;
    const nx = -dy / d, ny = dx / d;
    const rise = Math.sin(Math.min(ti * 2.6, 1) * Math.PI / 2);
    const lump = 1 + 0.16 * Math.sin(ti * 9 + r.seed) + 0.025 * Math.sin(t * 1.6 + ti * 5);
    const w = wRoot * rise * Math.pow(1 - ti, 1.05) * lump + 0.2;
    L.push({ x: n[i].x + nx * w, y: n[i].y + ny * w });
    R.push({ x: n[i].x - nx * w, y: n[i].y - ny * w });
  }
  return { L, R };
}
function drawTail(g, r, t) {
  const n = r.nodes, m = n.length, tip = n[m - 1], root = n[0];
  const { L, R } = tailOutline(r, t);
  const light = 40 + 14 * r.beatFit;
  const grad = g.createLinearGradient(root.x, root.y, tip.x, tip.y);
  grad.addColorStop(0, `hsl(174 62% ${light + 12}%)`);
  grad.addColorStop(0.65, `hsl(174 60% ${light}%)`);
  grad.addColorStop(1, `hsl(176 55% ${light - 16}%)`);
  g.beginPath();
  g.moveTo(L[0].x, L[0].y);
  for (const p of L) g.lineTo(p.x, p.y);
  g.lineTo(tip.x, tip.y);
  for (let i = m - 1; i >= 0; i--) g.lineTo(R[i].x, R[i].y);
  g.closePath();
  g.fillStyle = grad; g.fill();
  g.strokeStyle = "hsl(178 60% 18%)"; g.lineWidth = 1.5; g.stroke();
  g.strokeStyle = "rgba(10,60,56,0.35)"; g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 1; i < m - 1; i++) {
    const p = { x: (n[i].x * 2 + R[i].x) / 3, y: (n[i].y * 2 + R[i].y) / 3 };
    i === 1 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y);
  }
  g.stroke();
  g.strokeStyle = `rgba(220,255,252,${0.18 + 0.25 * r.beatFit})`; g.lineWidth = 3;
  g.beginPath();
  for (let i = 1; i < m - 2; i++) {
    const p = { x: (n[i].x + L[i].x * 1.2) / 2.2, y: (n[i].y + L[i].y * 1.2) / 2.2 };
    i === 1 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y);
  }
  g.stroke();
  // 髪に取り込まれた歌詞（描いている間に歌われていた文字）が流れる
  g.fillStyle = "rgba(228,255,253,0.7)"; g.font = "11px sans-serif"; g.textAlign = "center";
  for (let i = 2; i < m - 1; i += 2)
    g.fillText(r.chars[(i / 2 + Math.floor(t)) % r.chars.length], n[i].x, n[i].y + 4);
  // 付け根の飾り（四角のパネル。公式衣装のヘアアクセに合わせる）
  g.save();
  g.translate(root.x, root.y);
  g.rotate(Math.atan2(r.outDir.y, r.outDir.x) + Math.PI / 2);
  g.fillStyle = "#232830";
  g.beginPath(); g.roundRect(-10, -11, 20, 22, 3); g.fill();
  g.strokeStyle = "#3a4250"; g.lineWidth = 1.5; g.stroke();
  g.fillStyle = "rgba(236,64,142,0.9)";
  g.beginPath(); g.roundRect(-5, -6, 10, 12, 2); g.fill();
  g.restore();
}

// ---- 幾何ユーティリティ（採点にも使用） ---------------------------------------
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function polyLen(p) { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; }
function resample(pts, n) {
  const total = polyLen(pts), step = total / (n - 1), out = [{ ...pts[0] }];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1], b = pts[i], d = dist(a, b);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(q); a = q; d = dist(a, b); acc = 0;
      if (out.length === n) return out;
    }
    acc += d;
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out;
}

// ---- 入力 ---------------------------------------------------------------------
function pos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
}
cv.addEventListener("pointerdown", e => {
  ensureAudio();
  if (!vocalActive(posMs())) { flash = "ミクが歌っていない……（歌唱中しか髪は生えない）"; return; }
  cv.setPointerCapture(e.pointerId);
  const tapOnBeat = onBeat(posMs());
  if (tapOnBeat) flash = "ナイスタップ！";
  stroke = { pts: [{ ...pos(e), beat: tapOnBeat }], chars: [], lastChar: null, tapOnBeat };
  startHold();
});
cv.addEventListener("pointermove", e => {
  if (!stroke) return;
  const p = pos(e), last = stroke.pts[stroke.pts.length - 1];
  if (dist(p, last) > 5) {
    stroke.pts.push({ ...p, beat: onBeat(posMs()) });
    const c = findCharText(posMs());            // 描いている間に歌われた文字が髪の素材になる
    if (c && c !== stroke.lastChar) { stroke.chars.push(c); stroke.lastChar = c; }
  }
});
cv.addEventListener("pointerup", () => {
  stopHold();
  if (stroke && stroke.pts.length > 5) {
    const relOnBeat = onBeat(posMs());
    shaker(relOnBeat);
    if (relOnBeat) flash = "シャン♪";
    const fit = stroke.pts.filter(p => p.beat).length / stroke.pts.length;
    ropes.push(makeRope(stroke.pts, fit, stroke.chars, stroke.tapOnBeat, relOnBeat));
    if (ropes.length > 2) ropes.shift();
  }
  stroke = null;
});
document.getElementById("reset").onclick = () => { ropes.length = 0; result.textContent = ""; };

// ---- ミク度採点 ----------------------------------------------------------------
const result = document.getElementById("result");
function judge() {
  if (ropes.length < 2) { result.textContent = "ツインテールは 2 本描いてから（今 " + ropes.length + " 本）"; return; }
  const o = obj(), height = o.hh * 2;
  const [a, b] = ropes;
  const left  = a.drawn[0].x <= b.drawn[0].x ? a : b;
  const right = left === a ? b : a;

  // 対称性 30: 右を中心軸で鏡映し、リサンプル済み点列の平均距離
  const L = resample(left.drawn, 32);
  const R = resample(right.drawn, 32).map(p => ({ x: 2 * o.cx - p.x, y: p.y }));
  const meanD = L.reduce((s, p, i) => s + dist(p, R[i]), 0) / 32;
  const sym = 30 * clamp01(1 - meanD / 140);

  // つむじ位置 20: 理想アンカーは上部・左右対称
  const ideal = s => ({ x: o.cx + s * o.hw * 0.8, y: o.cy - o.hh * 0.85 });
  const anch = 20 * clamp01(1 - (dist(left.drawn[0], ideal(-1)) + dist(right.drawn[0], ideal(1))) / 2 / 130);

  // 長さ比 20: 髪長 ÷ 造形物高さ、理想 1.6
  const ratio = (left.len + right.len) / 2 / height;
  const lenS = 20 * clamp01(1 - Math.abs(ratio - 1.6) / 1.6);

  // ハリ・ツヤ 20: 描線のビート適合 12 ＋ 拍に合ったタップ 4 ＋ 拍に合ったリリース 4
  const shineOf = r => 12 * r.beatFit + 4 * (r.tapOnBeat ? 1 : 0) + 4 * (r.relOnBeat ? 1 : 0);
  const shine = (shineOf(left) + shineOf(right)) / 2;
  const taps = (left.tapOnBeat ? 1 : 0) + (right.tapOnBeat ? 1 : 0);
  const rels = (left.relOnBeat ? 1 : 0) + (right.relOnBeat ? 1 : 0);

  // 歌詞充填率 10: 髪に取り込めた文字数
  const fill = 10 * clamp01((left.chars.length + right.chars.length) / 16);

  const total = Math.round(sym + anch + lenS + shine + fill);
  const rank = total >= 85 ? "もはや本人" : total >= 60 ? "親戚" : total >= 30 ? "ミク味を感じる"
             : "それはただの" + o.name;
  result.innerHTML =
    `ミク度 <b>${total}%</b> ─ ${rank}\n` +
    `対称性 ${sym.toFixed(1)}/30 ・ つむじ位置 ${anch.toFixed(1)}/20 ・ 長さ比 ${lenS.toFixed(1)}/20 (${ratio.toFixed(2)})\n` +
    `ハリツヤ ${shine.toFixed(1)}/20（タップ ${taps}/2 ・ リリース ${rels}/2）・ 歌詞充填 ${fill.toFixed(1)}/10`;
}
document.getElementById("judge").onclick = judge;
const clamp01 = v => Math.max(0, Math.min(1, v));

// ---- 描画ループ ----------------------------------------------------------------
let flash = "", inChorus = false;
function loop() {
  const ms = posMs(), t = ms / 1000, g = cx2d;
  g.clearRect(0, 0, cv.width, cv.height);

  // サビ突入で自動判定（1 サビにつき 1 回）
  const chorus = ready && !!player.findChorus(ms);
  if (chorus && !inChorus && ropes.length === 2) judge();
  inChorus = chorus;

  const beat = ready && player.findBeat(ms);
  g.fillStyle = onBeat(ms) ? "#39c5bb" : "#2b3a44";
  g.beginPath(); g.arc(30, 30, 12 + (beat ? (1 - beat.progress(ms)) * 6 : 0), 0, 7); g.fill();
  g.fillStyle = "#9fb6bd"; g.font = "12px sans-serif"; g.textAlign = "left";
  g.fillText("BEAT", 50, 34);
  const amp = vocalAmp(ms);
  g.fillStyle = vocalActive(ms) ? "#39c5bb" : "#2b3a44";
  g.fillRect(110, 22, 120 * amp, 14);
  g.strokeStyle = "#2b3a44"; g.strokeRect(110, 22, 120, 14);
  g.fillStyle = "#9fb6bd";
  g.fillText(!ready ? "(読み込み中)" : vocalActive(ms) ? "VOCAL ♪" : chorus ? "(サビ)" : "(間奏)", 240, 34);
  g.textAlign = "right"; g.fillText("お題: " + obj().name, cv.width - 20, 34);
  g.textAlign = "left";

  obj().draw(g);
  for (const r of ropes) { stepRope(r, t); drawTail(g, r, t); }
  if (stroke) {
    g.strokeStyle = "#7fe8e0"; g.lineWidth = 6; g.lineCap = "round"; g.beginPath();
    g.moveTo(stroke.pts[0].x, stroke.pts[0].y);
    for (const q of stroke.pts) g.lineTo(q.x, q.y);
    g.stroke();
  }
  if (flash) { g.fillStyle = "#f2c519"; g.font = "16px sans-serif"; g.textAlign = "center";
               g.fillText(flash, cv.width / 2, 70); g.textAlign = "left";
               if (Math.random() < 0.01) flash = ""; }
  requestAnimationFrame(loop);
}
loop();

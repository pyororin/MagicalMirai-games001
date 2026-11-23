// とどけ!リリックホームラン(仮) — MVP 本体。描画・入力・進行。
// 設計: ../../docs/DESIGN.md。判定と投球生成は純関数(judge.js / chart.js)。
//
// 描画は「再生位置 pos」と「結果の記録 G.results」だけから毎フレーム組み立てる。
// 巻き戻されたら、その時刻より後の記録を捨てる(ontology: host-managed)。
import { SONGS, dataUrl } from "./songs.js";
import { DemoSource } from "./demo.js";
import { TextAliveSource } from "./textalive.js";
import { generatePitches, DIFFS } from "./chart.js";
import { carry, fence, FOUL_DEG } from "./carry.js";
import { WIN, judge, isHomerun, direction, pickPitch, tally } from "./judge.js";
import { Sfx } from "./sfx.js";

export const BUILD = 6;

const qs = new URLSearchParams(location.search);
const IS_DEMO = qs.has("demo");
const AUTO = qs.has("auto") ? Number(qs.get("auto")) || 0 : null; // 自動で振る(検証用)。値 = わざとずらす ms
const DEBUG = qs.has("debug");
const $ = (id) => document.getElementById(id);

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem("lh." + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("lh." + k, JSON.stringify(v));
    } catch (e) {}
  },
};

const G = {
  mode: "loading", // loading | ready | playing | paused | result
  song: null,
  chart: null,
  pitched: new Map(), // "pi:ci" → 球の番号
  results: [], // 球の番号 → { res, dt, at }
  swings: [], // 素振りも含む、振った時刻(描画用)
  diff: store.get("diff", "EASY"),
  offset: store.get("offset", 0),
  songVol: store.get("songVol", 0.8),
  sfxVol: store.get("sfxVol", 0.7),
  songReady: false,
  timerReady: false,
  lastPos: 0,
  endAt: 0,
  loadStarted: 0,
};

const sfx = new Sfx();
sfx.volume = G.sfxVol;
const source = IS_DEMO
  ? new DemoSource(BUILD)
  : new TextAliveSource({ build: BUILD, mediaEl: $("media") });

// ---------------------------------------------------------------- 画面
const cv = $("stage");
const cx = cv.getContext("2d");
let W = 0, H = 0, S = 1, FW = 0, X0 = 0;
function resize() {
  const d = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  cv.width = Math.round(W * d);
  cv.height = Math.round(H * d);
  cx.setTransform(d, 0, 0, d, 0, 0);
  S = Math.min(W / 390, H / 760);
  FW = Math.min(W, H * 0.62); // 遊ぶ範囲は縦長の柱。横長の画面では中央に置く
  X0 = (W - FW) / 2;
}
window.addEventListener("resize", resize);
resize();
const fx = (u) => X0 + u * FW;
const MOUND_V = 0.4, PLATE_V = 0.7;
const PITCHER_H = 0.14, BATTER_H = 0.24; // 身長(画面高に対する比。デザイン基本設計 §3 §4)
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT = '"Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic",system-ui,sans-serif';
const font = (px, w = 800) => `${w} ${Math.round(px)}px ${FONT}`;
/** 決定的なゆらぎ(球の番号 → 0..1)。同じプレイ記録なら同じ絵になる。 */
const hash01 = (n) => {
  const x = Math.sin((n + 1) * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

// 差し替え画像(data/art.json)。無ければコードで描いた仮の絵を使う
const ART = {};
fetch(dataUrl("data/art.json", BUILD), { cache: "no-cache" })
  .then((r) => (r.ok ? r.json() : {}))
  .then((j) => {
    // 打者の手元(ネギの付け根)。画像内の位置の比率 [左からx, 上からy]。右打ち。無ければ仮の絵の手元
    if (Array.isArray(j.batterHand) && j.batterHand.length === 2) ART.hand = j.batterHand;
    for (const k of ["background", "batter", "pitcher"]) {
      if (!j[k]) continue;
      const im = new Image();
      im.onload = () => (ART[k] = im);
      im.src = dataUrl(j[k], BUILD);
    }
  })
  .catch(() => {});

// ---------------------------------------------------------------- 曲
function beatAt(pos) {
  const b = G.song && G.song.beats;
  if (!b || !b.length || pos < b[0].t) return { phase: 0, idx: -1 };
  let lo = 0, hi = b.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (b[m].t <= pos) lo = m;
    else hi = m;
  }
  if (b[hi].t <= pos) lo = hi;
  const dur = lo < b.length - 1 ? b[lo + 1].t - b[lo].t : G.chart ? G.chart.beatMs : 500;
  return { phase: clamp((pos - b[lo].t) / (dur || 500), 0, 1), idx: lo };
}

function buildChart() {
  if (!G.song) return;
  G.chart = generatePitches(G.song, G.diff);
  G.pitched = new Map(G.chart.pitches.map((p) => [p.pi + ":" + p.ci, p.idx]));
  G.results = [];
  G.swings = [];
  const last = G.song.phrases[G.song.phrases.length - 1];
  G.endAt = last.e + 2500;
  $("chartInfo").textContent = `${G.chart.pitches.length}球中 ${G.chart.quota}本のホームランでクリア`;
}

function onSongReady(song) {
  G.song = song;
  G.songReady = true;
  buildChart();
  $("songCredit").textContent = ` 楽曲: ${song.title} / ${song.artist}`;
  if (source.managed) {
    // ホスト(TextAlive)が再生を握る。再生位置に追従するだけ
    G.mode = "playing";
    $("overlay").hidden = true;
  } else if (G.mode === "loading") G.mode = "ready";
  updateStart();
}

function updateStart() {
  const ok = !!(G.songReady && (source.kind === "demo" || G.timerReady));
  $("startBtn").disabled = !ok;
  if (G.mode === "loading" || G.mode === "ready") {
    $("ovTitle").textContent = ok ? "READY" : "LOADING…";
    if (ok) {
      $("ovText").textContent = "";
      $("ovErr").hidden = true;
    } else if (G.songReady) $("ovText").textContent = "音源の準備を待っています…";
  }
}

function showError(msg) {
  $("ovTitle").textContent = "ERROR";
  const d = source.diag || [];
  $("ovErr").textContent = msg + (d.length ? "\n\n" + d.join("\n") : "");
  $("ovErr").hidden = false;
}

async function loadSelected() {
  const def = SONGS.find((s) => s.code === $("songPick").value) || SONGS[0];
  G.songReady = false;
  G.timerReady = false;
  G.song = null;
  G.chart = null;
  G.mode = "loading";
  G.loadStarted = performance.now();
  $("chartInfo").textContent = "";
  $("ovText").textContent = "楽曲を読み込んでいます…";
  updateStart();
  try {
    if (source.kind === "demo") onSongReady(await source.loadSong(def));
    else await source.loadSong(def); // 完了は onVideoReady → ready イベント
  } catch (e) {
    showError(String((e && e.message) || e));
  }
}

// ---------------------------------------------------------------- 進行
function showOverlay(kind) {
  $("overlay").hidden = false;
  $("pauseBtn").hidden = true;
  $("setup").hidden = kind !== "menu";
  $("result").hidden = kind !== "result";
  $("quitBtn").hidden = kind !== "paused";
  $("startBtn").textContent = kind === "paused" ? "つづける" : kind === "result" ? "もういちど" : "スタート";
  $("ovTitle").textContent = kind === "paused" ? "PAUSE" : kind === "result" ? "" : "READY";
}

async function start() {
  const ctx = sfx.unlock();
  if (source.kind === "demo" && ctx) source.bindAudio(ctx);
  source.setVolume(G.songVol);
  if (G.mode === "paused") {
    G.mode = "playing";
  } else {
    G.results = [];
    G.swings = [];
    G.lastPos = 0;
    G.mode = "playing";
    if (source.getPosition() > 0) await source.seek(0);
  }
  $("overlay").hidden = true;
  $("pauseBtn").hidden = false;
  await source.play();
}

function pause() {
  if (G.mode !== "playing" || source.managed) return;
  source.pause();
  G.mode = "paused";
  showOverlay("paused");
}

function quit() {
  source.pause();
  Promise.resolve(source.seek(0)).catch(() => {});
  G.results = [];
  G.swings = [];
  G.mode = "ready";
  showOverlay("menu");
  updateStart();
}

function finish() {
  if (G.mode !== "playing") return;
  if (!source.managed) source.pause();
  G.mode = "result";
  const t = tally(G.chart.pitches, G.results);
  const n = G.chart.pitches.length;
  const clear = t.homeruns >= G.chart.quota;
  $("rRank").textContent = clear ? "クリア!" : "ざんねん…";
  $("rScore").textContent = `ホームラン ${t.homeruns}本 / ノルマ ${G.chart.quota}本(${n}球)`;
  const bias = Math.round(t.bias);
  const lat = sfx.latencyMs();
  $("rDetail").textContent =
    `特大 ${t.big} ・ ホームラン ${t.hr} ・ ヒット ${t.hit} ・ 空振り ${t.whiff} ・ 見逃し ${t.look}\n` +
    `振りの傾向: ${Math.abs(bias) < 15 ? "ちょうどいい" : bias < 0 ? "早め" : "遅め"}(平均 ${bias > 0 ? "+" : ""}${bias}ms)` +
    (Math.abs(bias) >= 25 ? ` → せっていの補正を ${bias < 0 ? "＋" : "－"} にすると合います` : "") +
    (lat != null ? `\n端末の音の遅れ: 約${lat}ms` : "");
  showOverlay("result");
}

/** 振る。tJudge = 判定に使う曲時刻(補正済み)。 */
function swing(pos, tJudge) {
  G.swings.push(pos);
  if (G.swings.length > 8) G.swings.shift();
  const i = pickPitch(G.chart.pitches, G.results, tJudge);
  if (i < 0) return sfx.play("swing");
  const dt = tJudge - G.chart.pitches[i].t;
  const res = judge(dt);
  if (!res) return sfx.play("swing");
  G.results[i] = { res, dt, at: pos };
  sfx.play(res);
}

function onPress(e) {
  if (G.mode !== "playing") return;
  if (e) e.preventDefault();
  sfx.unlock();
  const pos = source.getPosition();
  swing(pos, pos - G.offset);
}

function update(pos) {
  if (pos < G.lastPos - 1500) {
    // 巻き戻し: その時刻より後の記録を捨てる
    for (let i = 0; i < G.results.length; i++) if (G.results[i] && G.chart.pitches[i].t > pos) G.results[i] = undefined;
    G.swings = G.swings.filter((t) => t <= pos);
  }
  G.lastPos = pos;
  const P = G.chart.pitches;
  for (let i = 0; i < P.length; i++) {
    if (P[i].t > pos + WIN.whiff) break;
    if (G.results[i]) continue;
    if (AUTO != null && pos >= P[i].t + AUTO + G.offset) swing(pos, P[i].t + AUTO);
    else if (pos - G.offset > P[i].t + WIN.hit) G.results[i] = { res: "look", dt: 0, at: P[i].t + WIN.hit + G.offset };
  }
  if (!source.managed && pos >= G.endAt) finish();
}

// ---------------------------------------------------------------- 描画(仮の絵)
const BG = { x: 0, y: 0, w: 0, h: 0 }; // 背景画像を置いた範囲(観客などを、絵に合わせて置くため)
function drawBackground(pos) {
  BG.x = 0; BG.y = 0; BG.w = W; BG.h = H;
  if (ART.background) {
    const im = ART.background;
    const k = Math.max(W / im.width, H / im.height);
    BG.x = (W - im.width * k) / 2; BG.y = (H - im.height * k) / 2; BG.w = im.width * k; BG.h = im.height * k;
    cx.drawImage(im, BG.x, BG.y, BG.w, BG.h);
    return;
  }
  const sky = cx.createLinearGradient(0, 0, 0, H * 0.36);
  sky.addColorStop(0, "#8FD3F4");
  sky.addColorStop(1, "#DDF3FB");
  cx.fillStyle = sky;
  cx.fillRect(0, 0, W, H * 0.37);
  // 雲
  cx.fillStyle = "rgba(255,255,255,.85)";
  for (const [u, v, r] of [[0.16, 0.2, 26], [0.8, 0.13, 32], [0.55, 0.26, 20]]) {
    const x = fx(u) + Math.sin(pos / 9000 + u * 9) * 8 * S, y = H * v;
    for (const [dx, k] of [[-1, 0.7], [0, 1], [1, 0.75]]) {
      cx.beginPath();
      cx.arc(x + dx * r * S * 0.9, y + (1 - k) * r * S * 0.5, r * S * k, 0, 7);
      cx.fill();
    }
  }
  // 遠くの丘と森
  cx.fillStyle = "#A8D68A";
  cx.beginPath();
  cx.moveTo(0, H * 0.37);
  for (let i = 0; i <= 8; i++) cx.quadraticCurveTo(W * (i - 0.5) / 8, H * (0.27 + 0.03 * ((i * 7) % 3)), W * i / 8, H * 0.33);
  cx.lineTo(W, H * 0.4);
  cx.lineTo(0, H * 0.4);
  cx.fill();
  cx.fillStyle = "#5FA862";
  const tw = Math.max(34 * S, W / 26);
  for (let x = -tw; x < W + tw; x += tw * 0.8) {
    const k = hash01(Math.round(x / tw) + 40);
    cx.beginPath();
    cx.arc(x, H * 0.355 - k * 8 * S, tw * (0.55 + k * 0.25), 0, 7);
    cx.fill();
  }
  // 草原
  const g = cx.createLinearGradient(0, H * 0.36, 0, H);
  g.addColorStop(0, "#9BD46B");
  g.addColorStop(1, "#6FB94C");
  cx.fillStyle = g;
  cx.fillRect(0, H * 0.36, W, H * 0.64);
  cx.fillStyle = "rgba(255,255,255,.08)";
  for (let i = 0; i < 6; i += 2) cx.fillRect(0, H * (0.36 + 0.107 * i), W, H * 0.107);
  // 土(マウンドと打席)
  cx.fillStyle = "#E3B878";
  cx.beginPath();
  cx.ellipse(fx(0.5), H * (MOUND_V + 0.012), FW * 0.13, H * 0.022, 0, 0, 7);
  cx.fill();
  cx.beginPath();
  cx.ellipse(fx(0.5), H * (PLATE_V + 0.02), FW * 0.4, H * 0.075, 0, 0, 7);
  cx.fill();
  // ホームベース
  const px = fx(0.5), py = H * PLATE_V, r = 15 * S;
  cx.fillStyle = "#fff";
  cx.strokeStyle = "#B98F55";
  cx.lineWidth = 2 * S;
  cx.beginPath();
  cx.moveTo(px - r, py - r * 0.5);
  cx.lineTo(px + r, py - r * 0.5);
  cx.lineTo(px + r, py + r * 0.15);
  cx.lineTo(px, py + r * 0.7);
  cx.lineTo(px - r, py + r * 0.15);
  cx.closePath();
  cx.fill();
  cx.stroke();
}

/** 拍の輪(ホームの横。無彩色で、球と取り違えない。ontology: beat-visible-only-on-the-character) */
function drawBeat(pos) {
  const b = beatAt(pos);
  if (b.idx < 0) return;
  const x = fx(0.5) + FW * 0.2, y = H * (PLATE_V + 0.005);
  cx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - b.phase)})`;
  cx.lineWidth = 3 * S;
  cx.beginPath();
  cx.arc(x, y, (8 + 12 * b.phase) * S, 0, 7);
  cx.stroke();
  cx.fillStyle = "rgba(255,255,255,.8)";
  cx.beginPath();
  cx.arc(x, y, 4 * S, 0, 7);
  cx.fill();
}

function drawPitcher(pos) {
  const x = fx(0.5), y = H * MOUND_V, h = H * PITCHER_H;
  // 次に投げる球までの時間から、振りかぶりを決める
  let wind = 0;
  if (G.chart) {
    for (const p of G.chart.pitches) {
      const rel = p.t - G.chart.flight;
      if (rel < pos - 200) continue;
      if (rel > pos + 500) break;
      wind = pos < rel ? 1 - (rel - pos) / 500 : 1 - (pos - rel) / 200;
      break;
    }
  }
  if (ART.pitcher) {
    const im = ART.pitcher, k = h / im.height;
    cx.drawImage(im, x - im.width * k / 2, y - h - wind * 4 * S, im.width * k, h);
    return;
  }
  // 仮の投手(ミク以外。だれにするかは未定)
  cx.fillStyle = "rgba(0,0,0,.15)";
  cx.beginPath();
  cx.ellipse(x, y, h * 0.3, h * 0.07, 0, 0, 7);
  cx.fill();
  cx.fillStyle = "#F4E3C1";
  cx.strokeStyle = "#7A5A3A";
  cx.lineWidth = 2 * S;
  cx.beginPath();
  cx.ellipse(x, y - h * 0.32, h * 0.24, h * 0.3, 0, 0, 7);
  cx.fill();
  cx.stroke();
  cx.beginPath();
  cx.arc(x, y - h * 0.76, h * 0.22, 0, 7);
  cx.fill();
  cx.stroke();
  cx.fillStyle = "#E0563B";
  cx.beginPath();
  cx.arc(x, y - h * 0.82, h * 0.22, Math.PI, 0);
  cx.fill();
  // 腕
  cx.strokeStyle = "#7A5A3A";
  cx.lineWidth = 4 * S;
  cx.lineCap = "round";
  cx.beginPath();
  cx.moveTo(x + h * 0.2, y - h * 0.45);
  cx.lineTo(x + h * (0.38 - 0.1 * wind), y - h * (0.3 + 0.75 * wind));
  cx.stroke();
  cx.fillStyle = "#7A5A3A";
  cx.font = font(9 * S, 700);
  cx.textAlign = "center";
  cx.fillText("投手(仮)", x, y + 12 * S);
}

/** ネギの角度。押した瞬間に当たりの位置(0)へ行き、振り切りは後から付ける。 */
function negiAngle(pos) {
  const REST = -2.0;
  const last = G.swings.length ? G.swings[G.swings.length - 1] : -1e9;
  const d = pos - last;
  if (d < 0 || d > 520) return REST;
  if (d < 40) return lerp(-0.5, 0, d / 40);
  if (d < 200) return lerp(0, 1.25, (d - 40) / 160);
  if (d < 320) return 1.25;
  return lerp(1.25, REST, (d - 320) / 200);
}

function drawBatter(pos) {
  const x = fx(0.5) - FW * 0.19, y = H * (PLATE_V + 0.065), h = H * BATTER_H;
  const b = beatAt(pos);
  const bob = Math.sin(b.phase * Math.PI) * 2 * S;
  const a = negiAngle(pos);
  const swingK = clamp((a + 2.0) / 3.25, 0, 1); // 0=構え … 1=振り切り
  let hx = x + h * 0.2, hy = y - h * 0.5 - bob; // 手元(ネギの付け根)
  cx.fillStyle = "rgba(0,0,0,.15)";
  cx.beginPath();
  cx.ellipse(x, y, h * 0.28, h * 0.05, 0, 0, 7);
  cx.fill();
  if (ART.batter) {
    const im = ART.batter, k = h / im.height;
    cx.drawImage(im, x - im.width * k / 2, y - h - bob, im.width * k, h);
    if (ART.hand) { // 絵の拳から、ネギを出す
      hx = x - im.width * k / 2 + im.width * k * ART.hand[0];
      hy = y - h - bob + h * ART.hand[1];
    }
  } else {
    // 仮のミク(斜め後ろ姿)。ツインテールは振りに遅れてついてくる
    const sway = Math.sin(pos / 420) * 0.08 - swingK * 0.9 + (swingK > 0.99 ? 0 : 0);
    cx.lineCap = "round";
    for (const side of [-1, 1]) {
      const tx = x + side * h * 0.2, ty = y - h * 0.8 - bob;
      cx.strokeStyle = "#1E8F86";
      cx.lineWidth = h * 0.13;
      cx.beginPath();
      cx.moveTo(tx, ty);
      cx.quadraticCurveTo(tx + side * h * 0.12 + sway * h * 0.2, ty + h * 0.3, tx + side * h * 0.05 + sway * h * 0.5, ty + h * 0.62);
      cx.stroke();
      cx.strokeStyle = "#33BDB2";
      cx.lineWidth = h * 0.09;
      cx.stroke();
    }
    cx.fillStyle = "#4A5560"; // 体
    cx.beginPath();
    cx.ellipse(x, y - h * 0.42 - bob, h * 0.13, h * 0.2, 0, 0, 7);
    cx.fill();
    cx.fillStyle = "#2B3138"; // スカート
    cx.beginPath();
    cx.moveTo(x - h * 0.17, y - h * 0.2 - bob);
    cx.lineTo(x + h * 0.17, y - h * 0.2 - bob);
    cx.lineTo(x + h * 0.12, y - h * 0.33 - bob);
    cx.lineTo(x - h * 0.12, y - h * 0.33 - bob);
    cx.fill();
    cx.strokeStyle = "#2B3138"; // 脚
    cx.lineWidth = h * 0.05;
    for (const side of [-1, 1]) {
      cx.beginPath();
      cx.moveTo(x + side * h * 0.07, y - h * 0.2 - bob);
      cx.lineTo(x + side * h * 0.09, y - h * 0.02);
      cx.stroke();
    }
    cx.fillStyle = "#33BDB2"; // 後頭部
    cx.beginPath();
    cx.arc(x, y - h * 0.8 - bob, h * 0.17, 0, 7);
    cx.fill();
    cx.strokeStyle = "#F7D9C4"; // 腕
    cx.lineWidth = h * 0.045;
    cx.beginPath();
    cx.moveTo(x + h * 0.08, y - h * 0.55 - bob);
    cx.lineTo(hx, hy);
    cx.stroke();
  }
  // ネギ(白い根元を握り、緑の葉で打つ)
  const L = h * 0.62, c = Math.cos(a), s = Math.sin(a);
  cx.lineCap = "round";
  cx.strokeStyle = "#3B2A1A";
  cx.lineWidth = h * 0.075;
  cx.beginPath();
  cx.moveTo(hx, hy);
  cx.lineTo(hx + c * L, hy + s * L);
  cx.stroke();
  cx.strokeStyle = "#F7F7EC";
  cx.lineWidth = h * 0.05;
  cx.beginPath();
  cx.moveTo(hx, hy);
  cx.lineTo(hx + c * L * 0.5, hy + s * L * 0.5);
  cx.stroke();
  cx.strokeStyle = "#6CC04A";
  cx.beginPath();
  cx.moveTo(hx + c * L * 0.5, hy + s * L * 0.5);
  cx.lineTo(hx + c * L, hy + s * L);
  cx.stroke();
}

function textOf(p, pos, all) {
  let s = "";
  for (const c of p.chars) if (all || c.s <= pos) s += c.text;
  return s || p.chars[0].text;
}

/** 球に載せる文字。長いことばは頭の数文字だけ(全文は掲示板にある)。 */
function ballLabel(p) {
  const t = textOf(p, 0, true);
  return t.length > 5 ? t.slice(0, 4) + "…" : t;
}

function outlined(text, x, y, fill, stroke, lw) {
  cx.lineJoin = "round";
  cx.strokeStyle = stroke;
  cx.lineWidth = lw;
  cx.strokeText(text, x, y);
  cx.fillStyle = fill;
  cx.fillText(text, x, y);
}

/** スタンド(空)に届いたことばの位置。打球の方向と球の番号で決まる。 */
function landing(p, r, order) {
  const dir = direction(r.dt);
  return {
    x: fx(0.5) + dir * FW * 0.34 + (hash01(p.idx) - 0.5) * FW * 0.14,
    y: H * (0.155 + 0.027 * (order % 5)),
  };
}

function drawBalls(pos) {
  const C = G.chart, P = C.pitches;
  const px = fx(0.5), y0 = H * (MOUND_V - PITCHER_H * 0.55), y1 = H * (PLATE_V - 0.01);
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  let hrOrder = 0, hrTotal = 0;
  for (let i = 0; i < P.length; i++) if (G.results[i] && isHomerun(G.results[i].res)) hrTotal++;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], r = G.results[i];
    const rel = p.t - C.flight;
    if (rel > pos) break;
    const hit = r && r.res !== "look" && r.res !== "whiff";
    if (!hit) {
      // 飛んでくる球(まだ声になっていない=輪郭だけ)。空振り・見逃しはそのまま後ろへ抜ける
      const u = (pos - rel) / C.flight;
      if (u > 1.4) continue;
      const y = lerp(y0, y1, u), rad = lerp(6, 19, Math.min(u, 1.1)) * S;
      const al = u > 1 ? clamp(1 - (u - 1) / 0.4, 0, 1) : 1;
      cx.globalAlpha = al;
      cx.fillStyle = "rgba(0,0,0,.14)";
      cx.beginPath();
      cx.ellipse(px, y + rad * 1.5, rad * 0.9, rad * 0.3, 0, 0, 7);
      cx.fill();
      cx.fillStyle = r ? "#CFCFC8" : "#fff";
      cx.strokeStyle = "#3B2A1A";
      cx.lineWidth = 2 * S;
      cx.beginPath();
      cx.arc(px, y, rad, 0, 7);
      cx.fill();
      cx.stroke();
      cx.font = font(lerp(13, 27, Math.min(u, 1)) * S);
      outlined(ballLabel(p), px, y - rad - lerp(10, 20, Math.min(u, 1)) * S, r ? "#B8B8B0" : "#fff", r ? "#77776F" : "#3B2A1A", 4 * S);
      cx.globalAlpha = 1;
      continue;
    }
    const hr = isHomerun(r.res);
    const dir = direction(r.dt);
    const el = pos - r.at;
    const col = r.res === "big" ? "#FFD84A" : hr ? "#33BDB2" : "#fff";
    if (hr) {
      const order = hrOrder++;
      const L = landing(p, r, order);
      const u = clamp(el / 1000, 0, 1);
      const cxm = (px + L.x) / 2, cym = -H * 0.05;
      const k = 1 - u;
      const x = k * k * px + 2 * k * u * cxm + u * u * L.x;
      const y = k * k * y1 + 2 * k * u * cym + u * u * L.y;
      const age = hrTotal - 1 - order; // 新しいほど 0
      const settled = u >= 1;
      cx.globalAlpha = settled ? (age < 10 ? 1 : 0.5) : 1;
      const fs = (settled ? (r.res === "big" ? 17 : 14) : lerp(26, 16, u)) * S;
      cx.font = font(fs);
      const t = textOf(p, pos, false);
      const w = cx.measureText(t).width / 2 + 4;
      const tx = clamp(x, w, W - w);
      if (!settled) {
        cx.fillStyle = "#fff";
        cx.strokeStyle = "#3B2A1A";
        cx.lineWidth = 2 * S;
        cx.beginPath();
        cx.arc(x, y + fs * 0.9, lerp(12, 4, u) * S, 0, 7);
        cx.fill();
        cx.stroke();
      } else if (el < 1500) {
        // 届いた瞬間のきらめき
        const q = (el - 1000) / 500;
        cx.strokeStyle = `rgba(255,255,255,${1 - q})`;
        cx.lineWidth = 3 * S;
        cx.beginPath();
        cx.arc(tx, y, (10 + 30 * q) * S, 0, 7);
        cx.stroke();
      }
      outlined(t, tx, y, col, "#3B2A1A", 4 * S);
      cx.globalAlpha = 1;
    } else {
      // ヒット: 内野に落ちて消える
      if (el > 1800) continue;
      const u = clamp(el / 600, 0, 1);
      const x = px + dir * FW * 0.28 * u, y = lerp(y1, H * 0.5, u) - Math.sin(u * Math.PI) * H * 0.06;
      cx.globalAlpha = clamp((1800 - el) / 600, 0, 1);
      cx.font = font(17 * S);
      outlined(textOf(p, pos, false), x, y, col, "#3B2A1A", 4 * S);
      cx.globalAlpha = 1;
    }
  }
}

const LABEL = { big: "特大ホームラン!", hr: "ホームラン!", hit: "ヒット", whiff: "からぶり", look: "みのがし" };
function drawJudge(pos) {
  let last = null;
  for (let i = G.results.length - 1; i >= 0; i--) {
    const r = G.results[i];
    if (r && (!last || r.at > last.at)) last = r;
    if (r && pos - r.at > 3000) break;
  }
  if (!last) return;
  const el = pos - last.at;
  if (el < 0 || el > 800) return;
  const hr = isHomerun(last.res);
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  cx.globalAlpha = clamp((800 - el) / 250, 0, 1);
  cx.font = font((hr ? 26 : 20) * S * (1 + 0.25 * Math.max(0, 1 - el / 120)));
  const x = fx(0.5) + FW * 0.12, y = H * (PLATE_V - 0.13) - el * 0.02 * S;
  outlined(LABEL[last.res], x, y, last.res === "big" ? "#FFD84A" : hr ? "#fff" : "#F0EDE2", hr ? "#E0563B" : "#5B4A3A", 5 * S);
  if (last.res !== "look" && last.res !== "big") {
    cx.font = font(13 * S, 700);
    const s = (last.dt < 0 ? "はやい" : "おそい") + (DEBUG ? ` ${Math.round(last.dt)}ms` : "");
    outlined(s, x, y + 22 * S, "#fff", "#5B4A3A", 4 * S);
  }
  cx.globalAlpha = 1;
}

/** 掲示板: いまのフレーズ。投げられる文字だけ色を付ける(ontology: lyric-color-must-match-the-chart) */
function drawBoard(pos) {
  const bx = fx(0.5), bw = Math.min(FW * 0.94, 560 * S), by = H * 0.055, bh = H * 0.062;
  cx.fillStyle = "#FFF8E7";
  cx.strokeStyle = "#3B2A1A";
  cx.lineWidth = 3 * S;
  cx.beginPath();
  cx.roundRect(bx - bw / 2, by, bw, bh, 10 * S);
  cx.fill();
  cx.stroke();
  const phs = G.song.phrases;
  let pi = -1;
  for (let i = 0; i < phs.length; i++) {
    if (phs[i].e + 600 >= pos) {
      if (phs[i].s - 2500 <= pos) pi = i;
      break;
    }
  }
  if (pi < 0) return;
  const chars = phs[pi].chars;
  let fs = 21 * S;
  cx.font = font(fs);
  const full = chars.map((c) => c.text).join("");
  const tw = cx.measureText(full).width;
  if (tw > bw - 20 * S) {
    fs *= (bw - 20 * S) / tw;
    cx.font = font(fs);
  }
  cx.textAlign = "left";
  cx.textBaseline = "middle";
  let x = bx - cx.measureText(full).width / 2;
  const y = by + bh / 2;
  chars.forEach((c, ci) => {
    const w = cx.measureText(c.text).width;
    const idx = G.pitched.get(pi + ":" + ci);
    const sung = c.s <= pos;
    if (idx != null) {
      const r = G.results[idx];
      cx.fillStyle = r ? (isHomerun(r.res) ? "#33BDB2" : "#B8B0A0") : "#E0563B";
      cx.fillRect(x, y + fs * 0.62, w, 3 * S);
      cx.fillStyle = r ? (isHomerun(r.res) ? "#1E8F86" : "#9A9284") : "#E0563B";
    } else cx.fillStyle = sung ? "#3B2A1A" : "#B9AB93";
    cx.fillText(c.text, x, y);
    x += w;
  });
}

function drawHud() {
  const t = tally(G.chart.pitches, G.results);
  const n = G.chart.pitches.length;
  cx.textBaseline = "middle";
  cx.textAlign = "right";
  cx.font = font(15 * S);
  const done = t.homeruns >= G.chart.quota;
  outlined(`ホームラン ${t.homeruns} / ノルマ ${G.chart.quota}`, W - 10, H * 0.028, done ? "#FFD84A" : "#fff", "#3B2A1A", 4 * S);
  cx.textAlign = "left";
  cx.font = font(12 * S, 700);
  outlined(`のこり ${n - t.thrown}球`, 54, H * 0.028, "#fff", "#3B2A1A", 3.5 * S);
  if (G.song) {
    cx.textAlign = "center";
    cx.font = font(10 * S, 700);
    cx.fillStyle = "rgba(255,255,255,.9)";
    cx.fillText(`♪ ${G.song.title} / ${G.song.artist}`, fx(0.5), H - 9);
  }
}


// ---------------------------------------------------------------- 観客(ライブ会場)
// デザイン基本設計 §5。スタンドの左右の翼に、顔のない丸い頭と体の観客。ペンライトが拍で揺れる。
// 位置・色・揺れの位相は番号から決める(同じプレイなら同じ絵)。背景画像に合わせて、画像の範囲(BG)から座標を取る。
const CROWD_COLORS = ["#F7A8B8", "#8FB8E8", "#F7D86A", "#9EDCCB", "#FFFFFF", "#C9A8E8"];
function drawCrowd(pos) {
  const t = pos;
  const b = G.chart && G.mode !== "loading" && G.mode !== "ready" ? beatAt(pos) : { phase: (performance.now() % 600) / 600 };
  let hr = 0;
  if (G.chart) for (let i = 0; i < G.results.length; i++) if (G.results[i] && isHomerun(G.results[i].res)) hr++;
  const lights = clamp(0.3 + hr * 0.04, 0.3, 1); // ボルテージ: 連続ホームランでペンライトが増える
  const rows = 4;
  for (let wing = 0; wing < 2; wing++) {
    const u0 = wing === 0 ? 0.015 : 0.615, u1 = wing === 0 ? 0.385 : 0.985;
    for (let r = 0; r < rows; r++) {
      const v = 0.168 + r * 0.021; // 画像内の高さの比
      const n = 9 + (r % 2);
      const rad = BG.w * (0.0095 + r * 0.0009);
      for (let c = 0; c < n; c++) {
        const id = wing * 400 + r * 40 + c;
        const u = lerp(u0, u1, (c + 0.5 + (r % 2) * 0.35 - 0.17) / n);
        const x = BG.x + BG.w * u + (hash01(id) - 0.5) * rad * 0.6;
        const y = BG.y + BG.h * v + (hash01(id + 90) - 0.5) * rad * 0.4;
        const hop = Math.max(0, Math.sin((b.phase + hash01(id + 7) * 0.15) * Math.PI)) * rad * 0.18; // 拍で小さく弾む
        const col = CROWD_COLORS[Math.floor(hash01(id + 3) * CROWD_COLORS.length)];
        cx.lineWidth = Math.max(1, rad * 0.16);
        cx.strokeStyle = "#3B2A1A";
        // 体
        cx.fillStyle = col;
        cx.beginPath();
        cx.arc(x, y + rad * 1.55 - hop, rad * 1.15, Math.PI, 0);
        cx.closePath();
        cx.fill();
        cx.stroke();
        // 頭
        cx.fillStyle = "#F7D9C4";
        cx.beginPath();
        cx.arc(x, y - hop, rad * 0.78, 0, 7);
        cx.fill();
        cx.stroke();
        // ペンライト
        if (hash01(id + 11) < lights) {
          const sway = Math.sin((b.phase + hash01(id + 21)) * Math.PI * 2) * 0.55 + (hash01(id + 5) - 0.5) * 0.3;
          const lx = x + rad * 0.9, ly = y + rad * 0.4 - hop;
          cx.strokeStyle = hash01(id + 31) < 0.8 ? "#33BDB2" : "#FFD84A";
          cx.lineWidth = Math.max(1.5, rad * 0.32);
          cx.lineCap = "round";
          cx.beginPath();
          cx.moveTo(lx, ly);
          cx.lineTo(lx + Math.sin(sway) * rad * 1.9, ly - Math.cos(sway) * rad * 1.9);
          cx.stroke();
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 飛距離ウィンドウ(別枠)
// デザイン基本設計 §6。打球が「どのくらい・どの場所へ」届いたかを、真上から見たミニ図で見せる。
// 結果(G.results)から毎フレーム求めるので、曲の巻き戻しでも整合する。計算は carry.js(純関数)。
const CARRY_R = 172; // ミニ図に映す距離(m)
function drawCarryWindow(pos) {
  const w = Math.min(FW * 0.43, 190 * S), x = fx(0.985) - w, y = H * 0.285;
  const head = 20 * S, foot = 38 * S, fh = w * 0.66, h = head + fh + foot;
  // 結果から打球を集める
  const hits = [];
  for (let i = 0; i < G.results.length; i++) {
    const r = G.results[i];
    if (!r || r.at > pos) continue;
    const c = carry(r.res, r.dt, G.chart.pitches[i].idx);
    if (c) hits.push({ r, c });
  }
  hits.sort((a, b) => a.r.at - b.r.at);
  const last = hits[hits.length - 1];
  const best = hits.reduce((m, o) => Math.max(m, o.c.dist), 0);
  // 枠
  cx.fillStyle = "#FFF8E7";
  cx.strokeStyle = "#3B2A1A";
  cx.lineWidth = 3 * S;
  cx.beginPath();
  cx.roundRect(x, y, w, h, 12 * S);
  cx.fill();
  cx.stroke();
  cx.textBaseline = "middle";
  cx.textAlign = "left";
  cx.fillStyle = "#3B2A1A";
  cx.font = font(11 * S);
  cx.fillText("とんだ きょり", x + 10 * S, y + head * 0.55);
  if (best > 0) {
    cx.textAlign = "right";
    cx.fillStyle = "#7A6A55";
    cx.font = font(10 * S, 700);
    cx.fillText(`ベスト ${Math.round(best)}m`, x + w - 10 * S, y + head * 0.55);
  }
  // ミニ図(ホームが下の中央)
  const hx = x + w / 2, hy = y + head + fh - 4 * S;
  const sc = Math.min((w - 16 * S) / (2 * CARRY_R * Math.sin(Math.PI / 4)), (fh - 8 * S) / CARRY_R);
  const P = (m, deg) => [hx + Math.sin((deg * Math.PI) / 180) * m * sc, hy - Math.cos((deg * Math.PI) / 180) * m * sc];
  cx.save();
  cx.beginPath();
  cx.rect(x + 3 * S, y + head, w - 6 * S, fh);
  cx.clip();
  // 芝(扇形)
  cx.fillStyle = "#DDEFA0";
  cx.beginPath();
  cx.moveTo(hx, hy);
  for (let a = -45; a <= 45; a += 3) cx.lineTo(...P(CARRY_R, a));
  cx.closePath();
  cx.fill();
  // スタンド(フェンスの外の帯)
  cx.fillStyle = "#E7C9A0";
  cx.beginPath();
  for (let a = -45; a <= 45; a += 3) cx.lineTo(...P(fence(a), a));
  for (let a = 45; a >= -45; a -= 3) cx.lineTo(...P(fence(a) + 16, a));
  cx.closePath();
  cx.fill();
  // 内野
  cx.fillStyle = "#F5D9AE";
  cx.beginPath();
  cx.moveTo(hx, hy);
  cx.lineTo(...P(27.4, 45));
  cx.lineTo(...P(38.8, 0));
  cx.lineTo(...P(27.4, -45));
  cx.closePath();
  cx.fill();
  // 距離の輪(50 / 100 / 150m)
  cx.strokeStyle = "rgba(59,42,26,.35)";
  cx.lineWidth = 1 * S;
  cx.setLineDash([3 * S, 4 * S]);
  for (const m of [50, 100, 150]) {
    cx.beginPath();
    for (let a = -45; a <= 45; a += 3) (a === -45 ? cx.moveTo : cx.lineTo).call(cx, ...P(m, a));
    cx.stroke();
  }
  cx.setLineDash([]);
  cx.fillStyle = "rgba(59,42,26,.55)";
  cx.font = font(8 * S, 700);
  cx.textAlign = "center";
  for (const m of [50, 100, 150]) cx.fillText(String(m), ...P(m, 0));
  // フェンスとファウルライン
  cx.strokeStyle = "#3B2A1A";
  cx.lineWidth = 2.2 * S;
  cx.beginPath();
  for (let a = -45; a <= 45; a += 3) (a === -45 ? cx.moveTo : cx.lineTo).call(cx, ...P(fence(a), a));
  cx.stroke();
  cx.lineWidth = 1.6 * S;
  cx.beginPath();
  cx.moveTo(hx, hy);
  cx.lineTo(...P(CARRY_R, -45));
  cx.moveTo(hx, hy);
  cx.lineTo(...P(CARRY_R, 45));
  cx.stroke();
  // これまでの打球
  for (let i = 0; i < hits.length - 1; i++) {
    const { r, c } = hits[i];
    cx.fillStyle = r.res === "big" ? "#FFD84A" : r.res === "hr" ? "#33BDB2" : "#fff";
    cx.beginPath();
    cx.arc(hx + c.x * sc, hy - c.y * sc, 2.8 * S, 0, 7);
    cx.fill();
    cx.lineWidth = 1.2 * S;
    cx.stroke();
  }
  // 最新の打球: ホームから飛んでいく
  let shown = 0;
  if (last) {
    const age = pos - last.r.at;
    const u = clamp(age / 900, 0, 1), e = 1 - (1 - u) * (1 - u) * (1 - u);
    const lx = hx + last.c.x * sc * e, ly = hy - last.c.y * sc * e;
    shown = last.c.dist * e;
    cx.strokeStyle = "rgba(59,42,26,.7)";
    cx.lineWidth = 1.6 * S;
    cx.setLineDash([2 * S, 4 * S]);
    cx.beginPath();
    cx.moveTo(hx, hy);
    cx.lineTo(lx, ly);
    cx.stroke();
    cx.setLineDash([]);
    if (u >= 1 && age < 1600) {
      cx.strokeStyle = `rgba(255,255,255,${1 - (age - 900) / 700})`;
      cx.lineWidth = 3 * S;
      cx.beginPath();
      cx.arc(lx, ly, (6 + 14 * ((age - 900) / 700)) * S, 0, 7);
      cx.stroke();
    }
    cx.fillStyle = last.r.res === "hit" ? "#fff" : "#FFD84A";
    cx.strokeStyle = "#3B2A1A";
    cx.lineWidth = 2.2 * S;
    cx.beginPath();
    cx.arc(lx, ly, 6 * S, 0, 7);
    cx.fill();
    cx.stroke();
  }
  cx.fillStyle = "#fff";
  cx.strokeStyle = "#3B2A1A";
  cx.lineWidth = 2 * S;
  cx.beginPath();
  cx.arc(hx, hy, 3.4 * S, 0, 7);
  cx.fill();
  cx.stroke();
  cx.restore();
  // 数字と場所
  cx.textAlign = "center";
  const fy = y + head + fh;
  if (last) {
    cx.font = font(21 * S, 900);
    const hr = last.c.homerun;
    outlined(`${Math.round(shown)} m`, x + w / 2, fy + foot * 0.36, hr ? "#1E8F86" : "#3B2A1A", "#FFF8E7", 4 * S);
    cx.font = font(10 * S, 700);
    cx.fillStyle = "#3B2A1A";
    cx.fillText(last.c.place, x + w / 2, fy + foot * 0.8);
  } else {
    cx.font = font(10 * S, 700);
    cx.fillStyle = "#7A6A55";
    cx.fillText("うつと ここに", x + w / 2, fy + foot * 0.3);
    cx.fillText("とんだ きょりが でるよ", x + w / 2, fy + foot * 0.7);
  }
}

function frame() {
  requestAnimationFrame(frame); // 先に次を予約する(途中で例外や return があってもループが死なない)
  const playing = G.mode === "playing";
  const pos = G.chart && (playing || G.mode === "paused" || G.mode === "result") ? source.getPosition() : 0;
  if (playing && G.chart) update(pos);
  cx.clearRect(0, 0, W, H);
  drawBackground(playing ? pos : performance.now());
  drawCrowd(playing || G.mode === "paused" || G.mode === "result" ? pos : performance.now());
  drawPitcher(pos);
  if (G.chart && G.song && G.mode !== "loading" && G.mode !== "ready") {
    drawBeat(pos);
    drawBoard(pos);
    drawHud();
    drawBatter(pos);
    drawBalls(pos);
    drawCarryWindow(pos);
    drawJudge(pos);
  } else drawBatter(0);
}

// ---------------------------------------------------------------- 起動
function boot() {
  $("build").textContent = `build ${BUILD}${IS_DEMO ? " demo" : ""}`;
  if (window.LH_BUILD !== BUILD) $("build").textContent += ` (HTML=${window.LH_BUILD} 版が混ざっています。再読み込みしてください)`;
  $("demoLink").href = IS_DEMO ? "?" : "?demo=1";
  $("demoLink").textContent = IS_DEMO ? "実楽曲版(TextAlive)へ" : "デモ(TextAlive 無し・合成伴奏)";

  const pick = $("songPick");
  for (const s of SONGS) pick.add(new Option(s.title, s.code));
  pick.value = store.get("song", SONGS[0].code);
  if (!pick.value) pick.value = SONGS[0].code;
  pick.addEventListener("change", () => {
    store.set("song", pick.value);
    loadSelected();
  });

  const setDiff = (d) => {
    G.diff = DIFFS[d] ? d : "EASY";
    store.set("diff", G.diff);
    for (const b of $("diffRow").children) b.setAttribute("aria-pressed", String(b.dataset.diff === G.diff));
    if (G.song && G.mode !== "playing") buildChart();
  };
  for (const b of $("diffRow").children) b.addEventListener("click", () => setDiff(b.dataset.diff));
  setDiff(G.diff);

  const bind = (id, key, fmt, apply) => {
    const el = $(id), out = $(id + "V");
    el.value = G[key];
    const upd = () => {
      G[key] = Number(el.value);
      out.textContent = fmt(G[key]);
      store.set(key, G[key]);
      if (apply) apply(G[key]);
    };
    el.addEventListener("input", upd);
    upd();
  };
  bind("offset", "offset", (v) => (v > 0 ? "+" : "") + v + "ms");
  bind("songVol", "songVol", (v) => Math.round(v * 100) + "%", (v) => source.setVolume(v));
  bind("sfxVol", "sfxVol", (v) => Math.round(v * 100) + "%", (v) => {
    sfx.volume = v;
    if (sfx.out) sfx.out.gain.value = v;
  });

  $("startBtn").addEventListener("click", () => start().catch((e) => showError("再生を開始できません: " + e)));
  $("quitBtn").addEventListener("click", quit);
  $("pauseBtn").addEventListener("click", pause);
  cv.addEventListener("pointerdown", onPress);
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Space" || e.code === "Enter") {
      if (G.mode === "playing") onPress(e);
    } else if (e.code === "Escape") pause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });

  if (source.kind === "demo") {
    loadSelected();
  } else {
    source.onDiag = () => {};
    source.on("error", (m) => showError(m));
    source.on("appReady", (app) => {
      if (app.managed) $("setup").hidden = true;
      if (!app.songUrl) loadSelected();
    });
    source.on("mediaChange", () => {
      G.songReady = false;
      G.timerReady = false;
      G.loadStarted = performance.now();
      if (G.mode !== "playing") G.mode = "loading";
      updateStart();
    });
    source.on("ready", (song) => onSongReady(song));
    source.on("timerReady", () => {
      G.timerReady = true;
      updateStart();
    });
    source.on("end", () => {
      if (G.mode === "playing" && !source.managed) finish();
    });
    G.loadStarted = performance.now();
    source.init();
    // 見張り: 15秒で経過を出し、45秒で失敗として表示(ontology: watchdog-marks-slow-load-as-error)
    setInterval(() => {
      if (G.mode !== "loading" || !G.loadStarted) return;
      const el = performance.now() - G.loadStarted;
      if (G.songReady && G.timerReady) return;
      if (el > 45000) showError(G.songReady ? "音源の準備が終わりません(45秒)。ページを開き直してください。" : "楽曲の読み込みが終わりません(45秒)。通信環境を確認してください。");
      else if (el > 15000) $("ovText").textContent = "時間がかかっています… " + (source.diag || []).slice(-1).join("");
    }, 1000);
  }
  requestAnimationFrame(frame);
}

// 検証用の覗き窓(ontology: headless-verification-hooks)
window.__lh = { G, source, sfx, finish };
boot();

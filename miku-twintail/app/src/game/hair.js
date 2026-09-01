/* =============================================================================
 * 髪の形。
 *   1 本の房は「付け根からの相対座標の折れ線 pts」で表す。
 *   - スライドで作った房は、**指がなぞった軌跡そのもの**を間引いて持つ
 *   - タップだけで付く房は、お題の髪型から理想の曲線を合成して持つ
 *   どちらも同じ描き方・同じ採点にかけられる。座標はお題ローカル（倍率 1）。
 * ========================================================================== */
import { rr } from "./stages.js";

export const ANCHOR = { L: { x: -0.44, y: -0.44 }, R: { x: 0.44, y: -0.44 } };
export const PATH_N = 18;                  // 房 1 本を表す点の数（+1）

const MIN_FALL = 0.55;                     // 合成時、これ以上は寝かせない
const ROOT_LIFT = 0.30;                    // 付け根で少しだけ持ち上がる
const DOWN = Math.PI / 2;
const GRAVITY = 0.60;
export const norm = a => { while (a > Math.PI) a -= Math.PI * 2;
                           while (a < -Math.PI) a += Math.PI * 2; return a; };

/** お題の髪型から理想の房を合成する。タップだけで付く房と、ガイドの下書きに使う。
 *  経路は重力で曲がるので、素直に合成すると毛先の向きが指定角から数度ずれる。
 *  ずれた分を入力角から引いて 2 回作り直し、**毛先が指定角を向く**ようにしてある
 *  （こうしないと理想どおりに描いても角度点が満点にならない）*/
export function synthPath(angle, len, n = PATH_N) {
  let a = angle;
  for (let i = 0; i < 2; i++) {
    const got = pathMetrics(rawSynthPath(a, len, n)).angle;
    a = a - norm(got - angle);
  }
  return rawSynthPath(a, len, n);
}
function rawSynthPath(angle, len, n) {
  const outward = Math.cos(angle) < 0 ? -1 : 1;
  const rootAngle = -Math.PI / 2 + outward * ROOT_LIFT;
  let fall = angle;
  if (Math.sin(fall) < Math.sin(MIN_FALL))
    fall = outward > 0 ? MIN_FALL : Math.PI - MIN_FALL;
  const d = norm(fall - rootAngle), step = len / n, pts = [];
  let x = 0, y = 0;
  for (let i = 0; i <= n; i++) {
    pts.push({ x, y });
    const u = i / n, r = Math.min(1, u / 0.15), k = r * r * (3 - 2 * r);
    const base = rootAngle + d * k;
    const a = base + norm(DOWN - base) * GRAVITY * Math.max(0, (u - 0.28) / 0.72);
    x += Math.cos(a) * step; y += Math.sin(a) * step;
  }
  return pts;
}

/** 指の軌跡を房にする。付け根からの相対座標へ移し、ならしてから等間隔で間引く。
 *  「なぞったとおりの形」を保ちたいので、方向と長さへ潰さずに折れ線のまま持つ */
export function pathFromStroke(raw, n = PATH_N) {
  if (!raw || raw.length < 2) return null;
  const o = raw[0];
  let p = raw.map(q => ({ x: q.x - o.x, y: q.y - o.y }));
  // 3 点移動平均を 1 度だけ。手ぶれは落とすが、意図して描いた形は残す
  for (let pass = 0; pass < 1; pass++) {
    const q = p.map(v => ({ ...v }));
    for (let i = 1; i < p.length - 1; i++) {
      q[i].x = (p[i - 1].x + p[i].x * 2 + p[i + 1].x) / 4;
      q[i].y = (p[i - 1].y + p[i].y * 2 + p[i + 1].y) / 4;
    }
    p = q;
  }
  // 弧長で等間隔に取り直す
  const acc = [0];
  for (let i = 1; i < p.length; i++) acc.push(acc[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y));
  const total = acc[acc.length - 1];
  if (!(total > 1)) return null;
  const out = []; let j = 1;
  for (let i = 0; i <= n; i++) {
    const want = total * i / n;
    while (j < acc.length - 1 && acc[j] < want) j++;
    const a = acc[j - 1], b = acc[j], f = b > a ? (want - a) / (b - a) : 0;
    out.push({ x: p[j - 1].x + (p[j].x - p[j - 1].x) * f,
               y: p[j - 1].y + (p[j].y - p[j - 1].y) * f });
  }
  return out;
}

/** 房の形から採点に使う量を出す。「ツインテールらしさ」はこの 3 つで見る。
 *  len     … 弧長
 *  angle   … 付け根→毛先の向き
 *  descent … 付け根側 15% を除いた区間のうち、下へ向かっている割合。
 *            ツインテールは付け根から下へ落ちるので 1 に近いのが良い
 *  reach   … 毛先までの直線距離 ÷ 弧長。1 に近いほど「素直に伸びている」。
 *            ジグザグ・巻き込み・折り返しはすべてこの 1 つの値が下がる
 *            （手ぶれは間引きの段階でならしてあるので、意図した形だけが残る）*/
export function pathMetrics(pts) {
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) segs.push({ a: Math.atan2(dy, dx), d, dy });
  }
  if (!segs.length) return { len: 0, angle: 0, descent: 0, reach: 0 };
  let len = 0;
  for (const s of segs) len += s.d;
  const skip = Math.floor(segs.length * 0.15);
  let down = 0, span = 0;
  for (let i = skip; i < segs.length; i++) { span += segs[i].d; if (segs[i].dy > 0) down += segs[i].d; }
  const tip = pts[pts.length - 1], tipD = Math.hypot(tip.x, tip.y);
  return { len, angle: Math.atan2(tip.y, tip.x),
           descent: span ? down / span : 0, reach: len ? tipD / len : 0 };
}

/* ---- 描画 -------------------------------------------------------------- */
export function drawTie(g, x, y, rot, scale = 1) {
  g.save(); g.translate(x, y); g.rotate(rot + Math.PI / 2); g.scale(scale, scale);
  g.fillStyle = "#222831"; rr(g, -9, -10, 18, 20, 3);
  g.strokeStyle = "#3d4756"; g.lineWidth = 1.5; g.stroke();
  g.fillStyle = "rgba(236,64,142,.95)"; rr(g, -4.5, -5.5, 9, 11, 2);
  g.restore();
}

/** 折れ線に沿ってリボン状に描く。房は pts（お題ローカル）を持ち、sc で拡縮する */
export function drawTail(g, ax, ay, tail, t, alpha = 1, sc = 1) {
  const src = tail.pts;
  if (!src || src.length < 2) return;
  const n = src.length - 1;
  // 生きている感じの微揺れ。毛先ほど大きく、法線方向へ少しだけ
  const pts = src.map((p, i) => {
    const u = i / n;
    const q = src[Math.min(n, i + 1)], r = src[Math.max(0, i - 1)];
    const nx = -(q.y - r.y), ny = q.x - r.x, d = Math.hypot(nx, ny) || 1;
    const w = Math.sin(t * 2 + u * 4) * 1.2 * u;
    return { x: ax + (p.x + nx / d * w) * sc, y: ay + (p.y + ny / d * w) * sc };
  });
  const light = 40 + 16 * (tail.quality || 0);
  const grad = g.createLinearGradient(pts[0].x, pts[0].y, pts[n].x, pts[n].y);
  grad.addColorStop(0, `hsl(174 62% ${light + 12}%)`);
  grad.addColorStop(1, `hsl(176 55% ${light - 14}%)`);
  const halfW = i => { const u = i / n;
    return (15 * Math.sin(Math.min(u * 2.8, 1) * Math.PI / 2) * Math.pow(1 - u, 0.9) + 0.5) * sc; };
  const nrm = i => { const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n, i + 1)];
    const nx = -(q.y - p.y), ny = q.x - p.x, d = Math.hypot(nx, ny) || 1; return { x: nx / d, y: ny / d }; };
  g.save(); g.globalAlpha *= alpha;
  g.beginPath();
  for (let i = 0; i <= n; i++) { const v = nrm(i), w = halfW(i);
    const px = pts[i].x + v.x * w, py = pts[i].y + v.y * w;
    i === 0 ? g.moveTo(px, py) : g.lineTo(px, py); }
  for (let i = n; i >= 0; i--) { const v = nrm(i), w = halfW(i);
    g.lineTo(pts[i].x - v.x * w, pts[i].y - v.y * w); }
  g.closePath(); g.fillStyle = grad; g.fill();
  g.strokeStyle = "hsl(178 60% 17%)"; g.lineWidth = 1.2 * sc; g.stroke();
  g.strokeStyle = `rgba(220,255,252,${0.16 + 0.22 * (tail.quality || 0)})`; g.lineWidth = 2.4 * sc;
  g.beginPath();
  for (let i = 1; i < n - 2; i++) { const v = nrm(i), w = halfW(i) * 0.45;
    const px = pts[i].x + v.x * w, py = pts[i].y + v.y * w;
    i === 1 ? g.moveTo(px, py) : g.lineTo(px, py); }
  g.stroke();
  if (sc > 0.55 && tail.chars && tail.chars.length) {
    g.fillStyle = "rgba(228,255,253,.75)"; g.font = "10px sans-serif"; g.textAlign = "center";
    tail.chars.forEach((ch, i) => { const p = pts[Math.min(n, 3 + i * 2)]; if (p) g.fillText(ch, p.x, p.y + 3); });
  }
  const d0 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  drawTie(g, pts[0].x, pts[0].y, d0 - Math.PI / 2, sc);
  g.restore();
}

/** お題の髪型の下書き。ここに沿って伸ばすと角度点・ツインテール点が満点になる */
export function drawGhostTail(g, ax, ay, angle, len, t, alpha) {
  const pts = synthPath(angle, len).map(p => ({ x: ax + p.x, y: ay + p.y }));
  const n = pts.length - 1;
  g.save(); g.globalAlpha = alpha;
  g.strokeStyle = "rgba(255,230,109,.85)"; g.lineWidth = 2.5; g.setLineDash([7, 7]);
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  g.setLineDash([]);
  const tip = pts[n], prev = pts[n - 2];
  const a = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  g.fillStyle = "rgba(255,230,109,.9)";
  g.beginPath(); g.moveTo(tip.x, tip.y);
  g.lineTo(tip.x - Math.cos(a - 0.42) * 13, tip.y - Math.sin(a - 0.42) * 13);
  g.lineTo(tip.x - Math.cos(a + 0.42) * 13, tip.y - Math.sin(a + 0.42) * 13);
  g.closePath(); g.fill();
  g.restore();
}

/** 失敗の証。ネギが斜め上へ真っ直ぐ生えてしまう（out: 左房 -1 / 右房 +1）*/
export function drawNegi(g, x, y, sc, out) {
  g.save(); g.translate(x, y); g.rotate((out || 1) * 0.44); g.scale(sc, sc);
  g.fillStyle = "#6fbf4a"; rr(g, -9, -100, 7, 70, 4); rr(g, -1, -108, 7, 78, 4); rr(g, 7, -94, 6, 64, 4);
  g.fillStyle = "#eef6e2"; rr(g, -10, -36, 20, 42, 6);
  g.fillStyle = "#d9e7c4"; rr(g, -10, -40, 20, 7, 3);
  g.restore();
}

export function drawObject(g, o, x, y, scale, tails, t) {
  g.save(); g.translate(x, y); g.scale(scale, scale); o.draw(g); g.restore();
  for (const side of ["L", "R"]) {
    const tl = tails && tails[side]; if (!tl) continue;
    const rx = tl.rx !== undefined ? tl.rx : ANCHOR[side].x * o.w;
    const ry = tl.ry !== undefined ? tl.ry : ANCHOR[side].y * o.h;
    const ax = x + rx * scale, ay = y + ry * scale;
    if (tl.kind === "negi") drawNegi(g, ax, ay, scale, side === "L" ? -1 : 1);
    else drawTail(g, ax, ay, tl, t, 1, scale);
  }
}

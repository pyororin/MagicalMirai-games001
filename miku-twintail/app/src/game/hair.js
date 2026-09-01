/* =============================================================================
 * 髪の描画。「付け根から左右へ出て、重力にしたがって落ちる」形を作る。
 *   角度・長さはお題の髪型ごとに変わるので、目標の下書き(ghost)も同じ経路で描く。
 * ========================================================================== */
import { rr } from "./stages.js";

const MIN_FALL = 0.55;         // これ以上は寝かせない（毛先は必ず下を向く）
const ROOT_LIFT = 0.30;        // 髪留めのすぐ上で少しだけ持ち上がる
const DOWN = Math.PI / 2;      // 画面の真下
const GRAVITY = 0.60;          // 毛先がどれだけ真下へ寄るか
const norm = a => { while (a > Math.PI) a -= Math.PI * 2;
                    while (a < -Math.PI) a += Math.PI * 2; return a; };

/** 付け根から外向きに少し持ち上がり、指定の角度へ向き、毛先ほど重力で真下へ寄る。
 *  角度は「お題の髪型」で変わるので、経路の形だけを共通化してある。 */
export function tailPath(ax, ay, tail, t, N = 16) {
  const { angle, len } = tail, outward = Math.cos(angle) < 0 ? -1 : 1;
  const rootAngle = -Math.PI / 2 + outward * ROOT_LIFT;
  let fall = angle;
  if (Math.sin(fall) < Math.sin(MIN_FALL))
    fall = outward > 0 ? MIN_FALL : Math.PI - MIN_FALL;
  const d = norm(fall - rootAngle);
  const step = len / N, pts = []; let x = ax, y = ay;
  for (let i = 0; i <= N; i++) {
    pts.push({ x, y });
    const u = i / N, r = Math.min(1, u / 0.15), k = r * r * (3 - 2 * r);
    const base = rootAngle + d * k;
    const grav = GRAVITY * Math.max(0, (u - 0.28) / 0.72);
    const a = base + norm(DOWN - base) * grav + Math.sin(t * 2 + u * 2.5) * 0.02 * u;
    x += Math.cos(a) * step; y += Math.sin(a) * step;
  }
  return { pts, rootAngle, N };
}

export function drawTie(g, x, y, rot, scale = 1) {
  g.save(); g.translate(x, y); g.rotate(rot + Math.PI / 2); g.scale(scale, scale);
  g.fillStyle = "#222831"; rr(g, -9, -10, 18, 20, 3);
  g.strokeStyle = "#3d4756"; g.lineWidth = 1.5; g.stroke();
  g.fillStyle = "rgba(236,64,142,.95)"; rr(g, -4.5, -5.5, 9, 11, 2);
  g.restore();
}

export function drawTail(g, ax, ay, tail, t, alpha = 1, sc = 1) {
  const { pts, rootAngle, N } = tailPath(ax, ay, { ...tail, len: tail.len * sc }, t);
  const light = 40 + 16 * (tail.quality || 0);
  const grad = g.createLinearGradient(ax, ay, pts[N].x, pts[N].y);
  grad.addColorStop(0, `hsl(174 62% ${light + 12}%)`);
  grad.addColorStop(1, `hsl(176 55% ${light - 14}%)`);
  const halfW = i => { const u = i / N;
    return (15 * Math.sin(Math.min(u * 2.8, 1) * Math.PI / 2) * Math.pow(1 - u, 0.9) + 0.5) * sc; };
  const norm = i => { const p = pts[Math.max(0, i - 1)], q = pts[Math.min(N, i + 1)];
    const nx = -(q.y - p.y), ny = q.x - p.x, d = Math.hypot(nx, ny) || 1; return { x: nx / d, y: ny / d }; };
  g.save(); g.globalAlpha *= alpha;
  g.beginPath();
  for (let i = 0; i <= N; i++) { const n = norm(i), w = halfW(i);
    const px = pts[i].x + n.x * w, py = pts[i].y + n.y * w;
    i === 0 ? g.moveTo(px, py) : g.lineTo(px, py); }
  for (let i = N; i >= 0; i--) { const n = norm(i), w = halfW(i);
    g.lineTo(pts[i].x - n.x * w, pts[i].y - n.y * w); }
  g.closePath(); g.fillStyle = grad; g.fill();
  g.strokeStyle = "hsl(178 60% 17%)"; g.lineWidth = 1.2 * sc; g.stroke();
  g.strokeStyle = `rgba(220,255,252,${0.16 + 0.22 * (tail.quality || 0)})`; g.lineWidth = 2.4 * sc;
  g.beginPath();
  for (let i = 1; i < N - 2; i++) { const n = norm(i), w = halfW(i) * 0.45;
    const px = pts[i].x + n.x * w, py = pts[i].y + n.y * w;
    i === 1 ? g.moveTo(px, py) : g.lineTo(px, py); }
  g.stroke();
  if (sc > 0.55 && tail.chars && tail.chars.length) {
    g.fillStyle = "rgba(228,255,253,.75)"; g.font = "10px sans-serif"; g.textAlign = "center";
    tail.chars.forEach((ch, i) => { const p = pts[Math.min(N, 3 + i * 2)]; if (p) g.fillText(ch, p.x, p.y + 3); });
  }
  drawTie(g, ax, ay, rootAngle, sc);
  g.restore();
}

/** お題の髪型の下書き。ここに向かって伸ばすと角度点が満点になる */
export function drawGhostTail(g, ax, ay, angle, len, t, alpha) {
  const { pts, N } = tailPath(ax, ay, { angle, len }, t);
  g.save(); g.globalAlpha = alpha;
  g.strokeStyle = "rgba(255,230,109,.85)"; g.lineWidth = 2.5; g.setLineDash([7, 7]);
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
  g.setLineDash([]);
  const tip = pts[N], prev = pts[N - 2];
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

export const ANCHOR = { L: { x: -0.44, y: -0.44 }, R: { x: 0.44, y: -0.44 } };

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

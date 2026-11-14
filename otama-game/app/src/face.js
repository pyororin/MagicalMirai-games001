// ドット絵のミクの顔。80×80 ドット、固定パレット、アンチエイリアス無し。
//
// オタマトーンのミクを参考に、丸くて小さな目と口のシンプルな「ちびミク」にしている
// (怖く見えないこと = 可愛さが最優先。鋭いまつ毛・歯・濃い輪郭線は使わない)。
// 顔は「5つの表情の重み」で決まる。あ(ふつう) い(横にのばす) う(横からおさえる)
// え(たてにつぶす) お(たてにのばす=Oの口)。重みから、顔の幅・高さ・ほっぺの引っ張り・
// 眉・口の大きさを連続的に混ぜ、目と口の「型」だけを最大の重みで切り替える。
// だから指を動かす量に応じて、顔がむにっと変形していく。
//
// 表情を足すには EXPR に1行足し、drawEyes / drawMouth に型を足す(README 参照)。

export const FACE_W = 80;
export const FACE_H = 80;

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return (255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255);
}

const PAL = {
  // 髪
  hair: "#33BDB2", hairD: "#1F8E8E", hairDD: "#176B73", hairL: "#7CE3D8", hairLL: "#BFF5EE",
  // 肌
  skin: "#FFEBDD", skinS: "#FFD6C6", skinSS: "#F2B3A8", outline: "#F0B0A4",
  blush: "#FF9FB4", blush2: "#FFBCCA",
  // 目
  ink: "#16303C", white: "#F7FCFF", irisD: "#0B7C8E", irisM: "#1DB4C2", irisL: "#86EAEA", pupil: "#08384A",
  // 口
  mouthIn: "#8A2B45", tongue: "#FF8FA5", teeth: "#FFFFFF", lip: "#E88A98", lipD: "#B9566A",
  // 服・ヘッドセット
  shirt: "#B4BDC8", shirtS: "#8D97A5", sleeve: "#262A34", sleeveL: "#4A5060", tie: "#33BDB2", tieD: "#1F8E8E",
  gear: "#2C303B", gearL: "#565D6E", gearT: "#33BDB2",
  // 演出
  spark: "#FFFFFF", sweat: "#9BE3F5",
};
const C = {};
for (const k of Object.keys(PAL)) C[k] = hex(PAL[k]);

class Raster {
  constructor() {
    this.px = new Uint32Array(FACE_W * FACE_H);
    this.mask = new Uint8Array(FACE_W * FACE_H);
  }
  clear() {
    this.px.fill(0);
  }
  set(x, y, c) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= FACE_W || y >= FACE_H) return;
    this.px[y * FACE_W + x] = c;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= FACE_W || y >= FACE_H) return 0;
    return this.px[y * FACE_W + x];
  }
  /** 行ごとの [x0,x1] で塗る。画素の中心が範囲に入れば塗る。 */
  rows(y0, y1, fn, c) {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const r = fn(y + 0.5);
      if (!r) continue;
      const a = Math.ceil(r[0] - 0.5);
      const b = Math.floor(r[1] - 0.5);
      for (let x = a; x <= b; x++) this.set(x, y, typeof c === "function" ? c(x, y) : c);
    }
  }
  ellipse(cx, cy, rx, ry, c) {
    this.rows(cy - ry, cy + ry, (yc) => {
      const t = (yc - cy) / ry;
      if (Math.abs(t) > 1) return null;
      const hw = rx * Math.sqrt(1 - t * t);
      return [cx - hw, cx + hw];
    }, c);
  }
  poly(pts, c) {
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const p of pts) {
      ymin = Math.min(ymin, p[1]);
      ymax = Math.max(ymax, p[1]);
    }
    for (let y = Math.floor(ymin); y <= Math.ceil(ymax); y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.ceil(xs[i] - 0.5);
        const x1 = Math.floor(xs[i + 1] - 0.5);
        for (let x = x0; x <= x1; x++) this.set(x, y, typeof c === "function" ? c(x, y) : c);
      }
    }
  }
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** 折れ線を滑らかな曲線(Catmull-Rom)にして、太さを変えながら円でなぞる */
  stroke(pts, r0, r1, c, steps = 60) {
    const n = pts.length;
    const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    for (let s = 0; s <= steps; s++) {
      const u = (s / steps) * (n - 1);
      const i = Math.min(n - 2, Math.floor(u));
      const f = u - i;
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const cr = (a, b, c2, d) =>
        0.5 * (2 * b + (-a + c2) * f + (2 * a - 5 * b + 4 * c2 - d) * f * f + (-a + 3 * b - 3 * c2 + d) * f * f * f);
      const x = cr(p0[0], p1[0], p2[0], p3[0]);
      const y = cr(p0[1], p1[1], p2[1], p3[1]);
      const r = r0 + (r1 - r0) * (s / steps);
      this.ellipse(x, y, r, r, typeof c === "function" ? c(s / steps) : c);
    }
  }
  /** 文字スプライトを置く。flip で左右反転。pal は 1文字→色。'.' は透明。 */
  blit(rowsStr, x, y, pal, flip = false) {
    for (let j = 0; j < rowsStr.length; j++) {
      const row = rowsStr[j];
      const w = row.length;
      for (let i = 0; i < w; i++) {
        const ch = row[flip ? w - 1 - i : i];
        if (ch === "." || ch === " ") continue;
        const col = pal[ch];
        if (col) this.set(x + i, y + j, col);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 表情テーブル。ここに1行足すと表情が増える。                            */
/* fw/fh=顔の幅・高さの倍率  browY/browTilt=眉  blush=ほっぺの赤み        */
/* eye=目の型  mouth.type=口の型                                         */
/* ------------------------------------------------------------------ */
export const EXPR = {
  // あ: さわっただけ。にこにこで、小さく口をあけている
  a: { fw: 1.0, fh: 1.0, pull: 0.0, browY: 0, browTilt: 0.0, blush: 0.6, eye: "open", mouth: { type: "oval", w: 6, h: 5 } },
  // い: ほっぺを横にのばされて、むにーっと笑顔。目はにっこり弧
  i: { fw: 1.14, fh: 0.95, pull: 1.0, browY: -1, browTilt: 0.0, blush: 1.0, eye: "happy", mouth: { type: "smile", w: 17, h: 8 } },
  // う: 両側から押さえられて、ほっぺがぷくっ。口はちゅっと小さな丸
  u: { fw: 0.9, fh: 1.03, pull: -1.0, browY: 0, browTilt: -0.4, blush: 1.0, eye: "wide", mouth: { type: "pucker", w: 4, h: 4 } },
  // え: たてに押しつぶされて、むぎゅっ。口は横にきゅっと開く
  e: { fw: 1.1, fh: 0.88, pull: 0.5, browY: 1, browTilt: -0.3, blush: 0.8, eye: "flat", mouth: { type: "flat", w: 13, h: 4 } },
  // お: たてにのばされ、Oの口で元気に歌う。目はぎゅっと閉じた「＞ ＜」
  o: { fw: 0.94, fh: 1.12, pull: 0.0, browY: -2, browTilt: 0.0, blush: 0.7, eye: "shout", mouth: { type: "oval", w: 10, h: 12 } },
};
const VOWEL_KEYS = ["a", "i", "u", "e", "o"];

/** 重み w(合計1)から、連続パラメータを混ぜ、型は最大の重みのものを選ぶ */
export function mixExpr(w) {
  let best = "a";
  let bw = -1;
  const m = { fw: 0, fh: 0, pull: 0, browY: 0, browTilt: 0, blush: 0, mw: 0, mh: 0 };
  for (const k of VOWEL_KEYS) {
    const wk = w[k] || 0;
    if (wk > bw) { bw = wk; best = k; }
    const e = EXPR[k];
    m.fw += e.fw * wk; m.fh += e.fh * wk; m.pull += e.pull * wk;
    m.browY += e.browY * wk; m.browTilt += e.browTilt * wk; m.blush += e.blush * wk;
    m.mw += e.mouth.w * wk; m.mh += e.mouth.h * wk;
  }
  m.eye = EXPR[best].eye;
  m.mouthType = EXPR[best].mouth.type;
  m.dom = best;
  m.domW = bw;
  return m;
}

/* 閉じた目(線)のスプライト。左目用、右目は反転 */
const EYE_PAL = { k: C.ink };
const EYE_SHOUT = [
  "kk......",
  ".kkk....",
  "...kkk..",
  ".....kk.",
  "...kkk..",
  ".kkk....",
  "kk......",
];

/* ------------------------------------------------------------------ */
/* 本体                                                                 */
/* ------------------------------------------------------------------ */
export class MikuFace {
  constructor() {
    this.r = new Raster();
    this.canvas = null;
    this.ctx = null;
    this.imageData = null;
  }

  /** 描画先キャンバス(80×80)を作る。表示側は image-rendering:pixelated で拡大する */
  attach(canvas) {
    this.canvas = canvas;
    canvas.width = FACE_W;
    canvas.height = FACE_H;
    this.ctx = canvas.getContext("2d");
    this.imageData = this.ctx.createImageData(FACE_W, FACE_H);
  }

  /**
   * @param {object} s
   *  w: {a,i,u,e,o} 表情の重み(合計1) / blink: 0..1 / beat: 0..1 / singing: 声が出ているか / t: 秒
   */
  render(s) {
    const r = this.r;
    r.clear();
    const m = mixExpr(s.w || { a: 1 });
    const bounce = (s.beat || 0) * 1.0;
    const fw = m.fw;
    const fh = m.fh;
    const cx = 40;
    const cy = 42 + bounce * 0.5;
    const fx = (x) => cx + (x - 40) * fw;
    const fy = (y) => cy + (y - 42) * fh;
    this.G = { cx, cy, fw, fh, fx, fy };

    this.drawBackHair(r, cx, cy, fw, fh, s);
    this.drawBody(r, cx, cy, fh);
    this.drawHead(r, m, cx, cy, fw, fh);
    this.drawBlush(r, m, fx, fy);
    this.drawEyes(r, m, fx, fy, s.blink || 0);
    this.drawMouth(r, m, fx, fy, s.singing);
    this.drawFringe(r, cx, cy, fw, fh);
    this.drawBrows(r, m, fx, fy);
    this.drawHeadphones(r, cx, cy, fw, fh);
    this.drawFx(r, m, fx, fy);

    if (this.ctx) {
      new Uint32Array(this.imageData.data.buffer).set(r.px);
      this.ctx.putImageData(this.imageData, 0, 0);
    }
  }

  /* ---- 後ろ髪 + ちびツインテール ---- */
  drawBackHair(r, cx, cy, fw, fh, s) {
    const sway = Math.sin((s.t || 0) * 2.1) * 0.7 + (s.beat || 0) * 1.0;
    for (const side of [-1, 1]) {
      const pts = [
        [cx + side * 24 * fw, cy - 8],
        [cx + side * (30 * fw + 1), cy + 3],
        [cx + side * (32 * fw + 1 + sway * 0.5), cy + 15],
        [cx + side * (29 * fw + sway), cy + 26],
      ];
      r.stroke(pts.map((p) => [p[0] + side * 1.1, p[1]]), 8.6, 4.6, C.hairD);
      r.stroke(pts, 7.8, 3.8, C.hair);
      r.stroke(pts.map((p) => [p[0] - side * 2.4, p[1] - 0.8]), 2.4, 1.2, C.hairL, 40);
      // ヘアゴム
      const bx = cx + side * 25 * fw;
      const by = cy - 8;
      r.ellipse(bx + side * 1, by, 3.6, 3.6, C.gear);
      r.ellipse(bx + side * 1 - 0.6, by - 0.8, 1.3, 1.3, C.gearL);
    }
    r.ellipse(cx, cy - 4, 27.5 * fw, 25 * fh, C.hair);
  }

  /* ---- 首・小さな肩・ネクタイ ---- */
  drawBody(r, cx, cy, fh) {
    const top = cy + 18 * fh;
    r.rows(top, 72, () => [cx - 5, cx + 5], C.skinS);
    r.poly([[cx - 30, 80], [cx - 27, 71], [cx - 12, 66], [cx - 5, 66], [cx + 5, 66], [cx + 12, 66], [cx + 27, 71], [cx + 30, 80]], C.shirt);
    r.poly([[cx - 30, 80], [cx - 27, 71], [cx - 21, 69], [cx - 19, 80]], C.sleeve);
    r.poly([[cx + 30, 80], [cx + 27, 71], [cx + 21, 69], [cx + 19, 80]], C.sleeve);
    r.poly([[cx - 5, 66], [cx, 70], [cx + 5, 66]], C.skinS);
    r.poly([[cx - 2, 68], [cx + 2, 68], [cx + 3, 80], [cx - 3, 80]], C.tie);
    r.poly([[cx, 68], [cx + 2, 68], [cx + 3, 80], [cx, 80]], C.tieD);
  }

  /* ---- 顔: 丸い ---- */
  drawHead(r, m, cx, cy, fw, fh) {
    const rx = 24.5 * fw;
    const ry = 21.5 * fh;
    const pull = m.pull;
    const cheekY = cy + 6 * fh;
    const hw = (yc) => {
      const t = (yc - cy) / ry;
      if (Math.abs(t) > 1) return -1;
      let w = rx * Math.sqrt(1 - t * t);
      if (t > 0) w *= 1 - 0.1 * t * t; // あごはまるく
      // ほっぺ: 引っ張ると外へふくらむ(尖らせず、おもちのように丸く)。押さえるとへこむ
      const bump = Math.max(0, 1 - Math.pow((yc - cheekY) / (9 * fh), 2));
      w += pull * (pull > 0 ? 3.2 : 1.8) * bump;
      return w;
    };
    const rowsFn = (yc) => {
      const w = hw(yc);
      return w < 0 ? null : [cx - w, cx + w];
    };
    r.rows(cy - ry, cy + ry, rowsFn, C.skin);
    // やわらかい影(あご下)
    r.rows(cy + ry * 0.78, cy + ry, (yc) => {
      const w = hw(yc);
      return w < 0 ? null : [cx - w + 2, cx + w - 2];
    }, C.skinS);
    // 輪郭はうすい肌色の線だけ
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const w = hw(y + 0.5);
      if (w < 0) continue;
      r.set(Math.ceil(cx - w - 0.5), y, C.outline);
      r.set(Math.floor(cx + w - 0.5), y, C.outline);
    }
    this.headHW = hw;
    this.headRy = ry;
  }

  /* ---- ヘッドホン(耳) ---- */
  drawHeadphones(r, cx, cy, fw, fh) {
    const hw = this.headHW;
    for (const side of [-1, 1]) {
      const y = cy + 1;
      const ex = cx + side * (hw(y) + 0.5);
      r.ellipse(ex, y, 4.2, 5.4, C.gear);
      r.ellipse(ex - side * 0.8, y - 1.2, 1.6, 2.2, C.gearL);
      r.ellipse(ex + side * 0.3, y + 3.2, 1.8, 0.9, C.gearT);
    }
  }

  drawBlush(r, m, fx, fy) {
    const a = Math.max(0.2, Math.min(1, m.blush));
    for (const side of [-1, 1]) {
      const bx = fx(40 + side * 14.5);
      const by = fy(51.5);
      r.ellipse(bx, by, 3.6 + a * 1.4, 2.2 + a * 0.5, C.blush2);
      r.ellipse(bx, by, 2.2 + a * 0.8, 1.2 + a * 0.3, C.blush);
    }
  }

  /* ---- 目: まるくて大きい ---- */
  drawEyes(r, m, fx, fy, blink) {
    let type = m.eye;
    if (blink > 0.5 && (type === "open" || type === "wide")) type = "closed";
    for (const side of [-1, 1]) {
      const ex = fx(40 + side * 11.2);
      const ey = fy(43.5);
      this.drawEye(r, type, ex, ey, side);
    }
  }

  drawEye(r, type, ex, ey, side) {
    if (type === "open" || type === "wide") {
      const big = type === "wide";
      const rx = big ? 6 : 5.4;
      const ry = big ? 7.2 : 6.6;
      // 輪郭(濃紺)→ 虹彩のグラデ → ひとみ → ハイライト
      r.ellipse(ex, ey, rx + 0.9, ry + 0.9, C.ink);
      r.rows(ey - ry, ey + ry, (yc) => {
        const t = (yc - ey) / ry;
        if (Math.abs(t) > 1) return null;
        const hw = rx * Math.sqrt(1 - t * t);
        return [ex - hw, ex + hw];
      }, (x, y) => {
        const t = (y + 0.5 - ey) / ry;
        return t < -0.45 ? C.irisD : t < 0.15 ? C.irisM : t < 0.6 ? C.irisL : C.irisL;
      });
      r.ellipse(ex, ey + 0.4, rx * 0.46, ry * 0.5, C.pupil);
      // 大きなハイライトと小さなハイライト
      r.ellipse(ex - side * 1.9 + 0.3, ey - 2.4, 1.7, 1.7, C.spark);
      r.set(ex + side * 2.2, ey + 3, C.spark);
      r.set(ex + side * 3.2, ey + 2, C.spark);
      // 上まぶたのラインだけ少し太く(まつ毛は描かない)
      for (let dx = -Math.floor(rx); dx <= Math.floor(rx); dx++) {
        const t = dx / (rx + 0.5);
        r.set(ex + dx, ey - ry - 1.2 + (t * t) * 1.2, C.ink);
      }
    } else if (type === "happy") {
      // にっこり弧(^)
      for (let dx = -5; dx <= 5; dx++) {
        const y = ey + 1.5 - Math.round(4 * (1 - (dx / 5.6) * (dx / 5.6)));
        r.set(ex + dx, y, C.ink);
        r.set(ex + dx, y + 1, C.ink);
      }
    } else if (type === "flat") {
      // むぎゅっと細めた目(横線+下に小さな弧)
      for (let dx = -5; dx <= 5; dx++) {
        r.set(ex + dx, ey + 0, C.ink);
        r.set(ex + dx, ey + 1, C.ink);
      }
      r.set(ex - 5, ey + 2, C.ink);
      r.set(ex + 5, ey + 2, C.ink);
      r.set(ex - 1, ey + 2.4, C.irisM);
      r.set(ex + 1, ey + 2.4, C.irisM);
    } else if (type === "shout") {
      r.blit(EYE_SHOUT, Math.round(ex - 4), Math.round(ey - 3), EYE_PAL, side > 0);
    } else if (type === "closed") {
      for (let dx = -5; dx <= 5; dx++) {
        const y = ey + 1 + Math.round(2.2 * (dx / 5.6) * (dx / 5.6));
        r.set(ex + dx, y, C.ink);
        r.set(ex + dx, y + 1, C.ink);
      }
    }
  }

  /* ---- まゆ: ちいさな点線みたいな眉。怒り顔にならない角度だけ ---- */
  drawBrows(r, m, fx, fy) {
    for (const side of [-1, 1]) {
      const x0 = fx(40 + side * 8);
      const x1 = fx(40 + side * 14);
      const y = fy(34.5) + m.browY;
      const yi = y + m.browTilt * -1.2; // 内側
      const yo = y + m.browTilt * 1.0;
      r.line(x0, yi, x1, yo, C.hairD);
    }
  }

  /* ---- 口: ちいさく、まるく ---- */
  drawMouth(r, m, fx, fy, singing) {
    const mx = fx(40);
    const type = m.mouthType;
    const w = Math.max(3, m.mw);
    const h = Math.max(2, m.mh);
    const my = fy(type === "oval" && h > 8 ? 52 + h / 2 - 3 : 54);
    if (type === "oval") {
      const rx = w / 2;
      const ry = h / 2;
      r.ellipse(mx, my, rx + 0.9, ry + 0.9, C.lipD);
      r.ellipse(mx, my, rx, ry, C.mouthIn);
      if (h >= 4) r.ellipse(mx, my + ry * 0.5, rx * 0.8, ry * 0.5, C.tongue);
    } else if (type === "smile") {
      // 大きく笑った口(上は平ら、下がまるい)。歯は描かない
      const half = w / 2;
      for (let dy = 0; dy <= h; dy++) {
        const t = dy / h;
        const hw = half * Math.sqrt(Math.max(0, 1 - t * t));
        const y = Math.round(my - h / 2 + dy);
        for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
          if (Math.abs(dx) > hw) continue;
          const edge = dy === 0 || Math.abs(dx) >= hw - 0.5 || dy === h;
          r.set(mx + dx, y, edge ? C.lipD : C.mouthIn);
        }
      }
      r.ellipse(mx, my + h * 0.55, half * 0.55, h * 0.3, C.tongue);
    } else if (type === "flat") {
      const half = w / 2;
      for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
        if (Math.abs(dx) > half) continue;
        const edge = Math.abs(dx) >= half - 0.5;
        const t = Math.abs(dx) / half;
        const hh = Math.round(h * (1 - t * t * 0.5));
        for (let dy = 0; dy < hh; dy++) {
          const y = Math.round(my - h / 2 + dy);
          const e = edge || dy === 0 || dy === hh - 1;
          r.set(mx + dx, y, e ? C.lipD : dy >= hh - 2 && !edge ? C.tongue : C.mouthIn);
        }
      }
    } else if (type === "pucker") {
      const rr = Math.max(2, w / 2);
      r.ellipse(mx, my, rr + 1.3, rr + 1.3, C.lip);
      r.ellipse(mx, my, rr - 0.3, rr - 0.3, C.mouthIn);
      r.set(mx, my + 0.5, C.tongue);
    }
    if (singing) r.set(mx + Math.ceil(w / 2) + 3, my - 3, C.spark);
  }

  /* ---- 前髪: ぱっつんにまるい毛先 ---- */
  drawFringe(r, cx, cy, fw, fh) {
    const hw = this.headHW;
    const topY = cy - 27 * fh;
    const base = cy - 11 * fh;
    const R = 27.5 * fw;
    const hairTop = (x, y) => {
      const u = (x - cx) / R;
      if (Math.abs(u) > 1) return false;
      const yTop = cy - 4 - 25 * fh * Math.sqrt(1 - u * u);
      return y >= yTop;
    };
    // 毛先: まるいスカラップ(中央は少し分かれる)
    const tip = (x) => {
      const d = Math.abs(x - cx);
      const wave = Math.abs(Math.sin(((x - cx) * Math.PI) / (9 * fw)));
      const part = d < 2 ? -3 + d * 1.2 : 0; // 真ん中のわけ目
      const sweep = Math.min(1, d / (22 * fw));
      return base + 5 * wave * (1 - sweep * 0.4) - sweep * sweep * 6 + part;
    };
    for (let y = Math.floor(topY); y <= Math.ceil(cy + 10); y++) {
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const yc = y + 0.5;
        const xc = x + 0.5;
        if (!hairTop(xc, yc)) continue;
        const inFringe = yc < tip(xc);
        // サイドの髪(顔の縁にそって下りる)
        const w = hw(yc);
        const side = w > 0 && Math.abs(xc - cx) > w - 2.6 && Math.abs(xc - cx) < w + 3 && yc < cy + 9;
        if (inFringe || side) r.set(x, y, C.hair);
      }
    }
    // 毛束の筋(うすい影)と、てっぺんのつや
    for (const dx of [-14, -7, 7, 14]) {
      const x = cx + dx * fw;
      for (let y = topY + 4; y < tip(x) - 2; y++) if ((y | 0) % 2 === 0) r.set(x, y, C.hairD);
    }
    for (let x = Math.floor(cx - 15 * fw); x <= Math.ceil(cx + 15 * fw); x++) {
      const u = (x - cx) / (15 * fw);
      const y = Math.round(cy - 4 - 25 * fh * Math.sqrt(1 - Math.pow((x - cx) / R, 2)) + 4.2 + u * u * 2);
      r.set(x, y, C.hairL);
      if (Math.abs(u) < 0.5) r.set(x, y - 1 + 2, C.hairLL);
    }
  }

  /* ---- 効果(マンガ記号) ---- */
  drawFx(r, m, fx, fy) {
    const d = m.dom;
    if (m.domW < 0.6) return;
    const col = C.spark;
    if (d === "i") {
      // きらきら
      const sp = (x, y) => {
        r.set(x, y, col);
        r.set(x - 1, y, col);
        r.set(x + 1, y, col);
        r.set(x, y - 1, col);
        r.set(x, y + 1, col);
      };
      sp(fx(40 - 28), fy(30));
      sp(fx(40 + 28), fy(34));
    } else if (d === "u") {
      for (const side of [-1, 1]) {
        const x = fx(40 + side * 26) + side * 3;
        r.line(x, fy(46), x - side * 2, fy(49), col);
        r.line(x - side * 2, fy(49), x, fy(52), col);
      }
    } else if (d === "e") {
      r.ellipse(fx(40 - 24), fy(32), 1.4, 2.0, C.sweat);
      r.set(fx(40 - 24), fy(29.4), C.sweat);
    } else if (d === "o") {
      for (const side of [-1, 1]) {
        const x = 40 + side * 31;
        r.line(x, fy(32), x + side * 3, fy(29), col);
        r.line(x + side, fy(38), x + side * 5, fy(38), col);
      }
    }
  }
}

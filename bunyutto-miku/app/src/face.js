// ドット絵のミクの顔。320×320 ドット(論理80×80の4倍)、固定パレット、アンチエイリアス無し。
//
// 丸くて小さな目と口のシンプルな「ちびミク」にしている
// (怖く見えないこと = 可愛さが最優先。鋭いまつ毛・歯・濃い輪郭線は使わない)。
// 顔は「5つの表情の重み」で決まる。あ(ふつう) い(横にのばす) う(横からおさえる)
// え(たてにつぶす) お(たてにのばす=Oの口)。重みから、顔の幅・高さ・ほっぺの引っ張り・
// 眉・口の大きさを連続的に混ぜ、目と口の「型」だけを最大の重みで切り替える。
// だから指を動かす量に応じて、顔がむにっと変形していく。
//
// 表情を足すには EXPR に1行足し、drawEyes / drawMouth に型を足す(README 参照)。

// 論理座標は 80×80(描画コードはこの単位で書く)。実解像度はその S 倍。
// S=4 → 320×320 ドット。表示時に滑らかに拡大するので、ドットは一見わからない細かさになる。
export const FACE_LOGICAL = 80;
export const FACE_S = 4;
export const FACE_W = FACE_LOGICAL * FACE_S;
export const FACE_H = FACE_LOGICAL * FACE_S;
const S = FACE_S;

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

const lerpC = (a, b, t) => {
  t = Math.max(0, Math.min(1, t));
  const ch = (sh) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (255 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** 論理座標(80×80 基準)で描き、実画素は S 倍の解像度で塗る */
class Raster {
  constructor() {
    this.px = new Uint32Array(FACE_W * FACE_H);
  }
  clear() {
    this.px.fill(0);
  }
  put(X, Y, c) {
    if (X < 0 || Y < 0 || X >= FACE_W || Y >= FACE_H) return;
    this.px[Y * FACE_W + X] = c;
  }
  get(x, y) {
    const X = Math.floor(x * S);
    const Y = Math.floor(y * S);
    if (X < 0 || Y < 0 || X >= FACE_W || Y >= FACE_H) return 0;
    return this.px[Y * FACE_W + X];
  }
  /** 行ごとの [x0,x1](論理)で塗る。c は色 or (x,y)=>色 */
  rows(y0, y1, fn, c) {
    const f = typeof c === "function";
    for (let Y = Math.floor(y0 * S); Y <= Math.ceil(y1 * S); Y++) {
      const yc = (Y + 0.5) / S;
      const r = fn(yc);
      if (!r) continue;
      const a = Math.ceil(r[0] * S - 0.5);
      const b = Math.floor(r[1] * S - 0.5);
      for (let X = a; X <= b; X++) this.put(X, Y, f ? c((X + 0.5) / S, yc) : c);
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
    const f = typeof c === "function";
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const p of pts) {
      ymin = Math.min(ymin, p[1]);
      ymax = Math.max(ymax, p[1]);
    }
    for (let Y = Math.floor(ymin * S); Y <= Math.ceil(ymax * S); Y++) {
      const yc = (Y + 0.5) / S;
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
        const a = Math.ceil(xs[i] * S - 0.5);
        const b = Math.floor(xs[i + 1] * S - 0.5);
        for (let X = a; X <= b; X++) this.put(X, Y, f ? c((X + 0.5) / S, yc) : c);
      }
    }
  }
  /** 太さ w(論理単位)の線分 */
  line(x0, y0, x1, y1, c, w = 1) {
    const r = (w * S) / 2;
    const X0 = x0 * S, Y0 = y0 * S, X1 = x1 * S, Y1 = y1 * S;
    const minX = Math.floor(Math.min(X0, X1) - r - 1), maxX = Math.ceil(Math.max(X0, X1) + r + 1);
    const minY = Math.floor(Math.min(Y0, Y1) - r - 1), maxY = Math.ceil(Math.max(Y0, Y1) + r + 1);
    const dx = X1 - X0, dy = Y1 - Y0;
    const l2 = dx * dx + dy * dy || 1;
    for (let Y = minY; Y <= maxY; Y++) {
      for (let X = minX; X <= maxX; X++) {
        let t = ((X + 0.5 - X0) * dx + (Y + 0.5 - Y0) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const px = X0 + t * dx - (X + 0.5);
        const py = Y0 + t * dy - (Y + 0.5);
        if (px * px + py * py <= r * r) this.put(X, Y, c);
      }
    }
  }
  polyline(pts, c, w = 1) {
    for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, w);
  }
  /** 折れ線を滑らかな曲線(Catmull-Rom)にして、太さを変えながら円でなぞる */
  stroke(pts, r0, r1, c) {
    const n = pts.length;
    const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];
    let len = 0;
    for (let i = 0; i + 1 < n; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const steps = Math.max(8, Math.ceil(len / 0.9));
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

/* ------------------------------------------------------------------ */
/* 本体                                                                 */
/* ------------------------------------------------------------------ */
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class MikuFace {
  constructor() {
    this.r = new Raster();
    this.canvas = null;
    this.ctx = null;
    this.imageData = null;
    this.lastKey = "";
  }

  /** 描画先キャンバス(320×320)。表示側は滑らかに縮小/拡大する */
  attach(canvas) {
    this.canvas = canvas;
    canvas.width = FACE_W;
    canvas.height = FACE_H;
    this.ctx = canvas.getContext("2d");
    this.imageData = this.ctx.createImageData(FACE_W, FACE_H);
    this.lastKey = "";
  }

  /**
   * @param {object} s
   *  w: {a,i,u,e,o} 表情の重み(合計1) / blink: 0..1 / beat: 0..1 / singing: 声が出ているか / t: 秒
   */
  render(s) {
    const w = s.w || { a: 1 };
    const sway = Math.round((Math.sin((s.t || 0) * 2.1) * 0.7 + (s.beat || 0)) * 6) / 6;
    // 見た目が変わらないフレームは描き直さない(高解像度なので重い)
    const key = [
      ...VOWEL_KEYS.map((k) => Math.round((w[k] || 0) * 30)),
      s.blink > 0.5 ? 1 : 0,
      Math.round((s.beat || 0) * 12),
      sway,
      s.singing ? 1 : 0,
    ].join(",");
    if (key === this.lastKey) return;
    this.lastKey = key;

    const r = this.r;
    r.clear();
    const m = mixExpr(w);
    const bounce = (s.beat || 0) * 1.0;
    const fw = m.fw;
    const fh = m.fh;
    const cx = 40;
    const cy = 42 + bounce * 0.5;
    const fx = (x) => cx + (x - 40) * fw;
    const fy = (y) => cy + (y - 42) * fh;

    this.drawBackHair(r, cx, cy, fw, fh, sway);
    this.drawBody(r, cx, cy, fh);
    this.drawHead(r, m, cx, cy, fw, fh);
    this.drawBlush(r, m, fx, fy);
    this.drawEyes(r, m, fx, fy, s.blink || 0);
    this.drawMouth(r, m, fx, fy, s.singing);
    this.drawFringe(r, cx, cy, fw, fh);
    this.drawBrows(r, m, fx, fy);
    this.drawHeadphones(r, cx, cy);
    this.drawFx(r, m, fx, fy);

    if (this.ctx) {
      new Uint32Array(this.imageData.data.buffer).set(r.px);
      this.ctx.putImageData(this.imageData, 0, 0);
    }
  }

  /* ---- 後ろ髪 + ちびツインテール ---- */
  drawBackHair(r, cx, cy, fw, fh, sway) {
    for (const side of [-1, 1]) {
      const pts = [
        [cx + side * 24 * fw, cy - 8],
        [cx + side * (30 * fw + 1), cy + 3],
        [cx + side * (32 * fw + 1 + sway * 0.5), cy + 15],
        [cx + side * (29 * fw + sway), cy + 26],
      ];
      r.stroke(pts.map((p) => [p[0] + side * 1.1, p[1]]), 8.6, 4.6, C.hairD);
      r.stroke(pts, 7.8, 3.8, (u) => lerpC(C.hair, C.hairD, smooth(0.55, 1, u) * 0.55));
      r.stroke(pts.map((p) => [p[0] - side * 2.4, p[1] - 0.8]), 2.2, 1.0, C.hairL);
      r.stroke(pts.map((p) => [p[0] - side * 2.6, p[1] - 0.8]), 0.9, 0.4, C.hairLL);
      // 毛束の筋
      for (const o of [-1.2, 1.6]) {
        r.polyline(pts.slice(1).map((p) => [p[0] + side * o, p[1]]), C.hairD, 0.35);
      }
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
    r.poly([[cx - 30, 80], [cx - 27, 71], [cx - 12, 66], [cx - 5, 66], [cx + 5, 66], [cx + 12, 66], [cx + 27, 71], [cx + 30, 80]], (x, y) => lerpC(C.shirt, C.shirtS, smooth(66, 80, y) * 0.6));
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
    // 肌: あご下に向かってやわらかく影になる
    r.rows(cy - ry, cy + ry, rowsFn, (x, y) => lerpC(C.skin, C.skinS, smooth(0.45, 1.0, (y - cy) / ry)));
    // 輪郭はうすい肌色の線だけ
    const ow = 0.55;
    for (let Y = Math.floor((cy - ry) * S); Y <= Math.ceil((cy + ry) * S); Y++) {
      const yc = (Y + 0.5) / S;
      const w = hw(yc);
      if (w < 0) continue;
      const a = Math.ceil((cx - w) * S - 0.5);
      const b = Math.floor((cx + w) * S - 0.5);
      for (let k = 0; k < ow * S; k++) {
        r.put(a + k, Y, C.outline);
        r.put(b - k, Y, C.outline);
      }
    }
    for (let X = Math.ceil((cx - rx * 0.4) * S); X <= Math.floor((cx + rx * 0.4) * S); X++) {
      const xc = (X + 0.5) / S;
      const t = (xc - cx) / rx;
      const yb = cy + ry * Math.sqrt(Math.max(0, 1 - t * t * 0.0)) - 0.0;
      void yb;
    }
    this.headHW = hw;
    this.headRy = ry;
  }

  /* ---- ヘッドホン(耳) ---- */
  drawHeadphones(r, cx, cy) {
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
      const rx = 3.8 + a * 1.4;
      const ry = 2.3 + a * 0.5;
      // 中心ほど濃い、ふんわりした頬紅
      r.rows(by - ry, by + ry, (yc) => {
        const t = (yc - by) / ry;
        if (Math.abs(t) > 1) return null;
        const hw = rx * Math.sqrt(1 - t * t);
        return [bx - hw, bx + hw];
      }, (x, y) => {
        const d = Math.hypot((x - bx) / rx, (y - by) / ry);
        return lerpC(C.blush, C.blush2, smooth(0.2, 1, d));
      });
    }
  }

  /* ---- 目: まるくて大きい ---- */
  drawEyes(r, m, fx, fy, blink) {
    let type = m.eye;
    if (blink > 0.5 && (type === "open" || type === "wide")) type = "closed";
    for (const side of [-1, 1]) {
      this.drawEye(r, type, fx(40 + side * 11.2), fy(43.5), side);
    }
  }

  drawEye(r, type, ex, ey, side) {
    if (type === "open" || type === "wide") {
      const big = type === "wide";
      const rx = big ? 6 : 5.4;
      const ry = big ? 7.2 : 6.6;
      r.ellipse(ex, ey, rx + 0.7, ry + 0.7, C.ink);
      // 虹彩: 上が濃く、下が明るいなめらかなグラデーション
      r.ellipse(ex, ey, rx, ry, (x, y) => {
        const t = (y - ey) / ry;
        return t < 0.1 ? lerpC(C.irisD, C.irisM, smooth(-1, 0.1, t)) : lerpC(C.irisM, C.irisL, smooth(0.1, 0.95, t));
      });
      r.ellipse(ex, ey + 0.4, rx * 0.46, ry * 0.5, C.pupil);
      // 大きなハイライトと小さなハイライト
      r.ellipse(ex - side * 1.9 + 0.3, ey - 2.4, 1.7, 1.8, C.spark);
      r.ellipse(ex + side * 2.4, ey + 3.0, 0.7, 0.7, C.spark);
      r.ellipse(ex + side * 3.3, ey + 1.8, 0.45, 0.45, C.spark);
      // 上まぶたのライン(まつ毛は描かない)
      const pts = [];
      for (let k = -8; k <= 8; k++) {
        const u = k / 8;
        pts.push([ex + u * (rx + 0.2), ey - ry * Math.sqrt(1 - u * u) - 0.5]);
      }
      r.polyline(pts, C.ink, 1.3);
    } else if (type === "happy") {
      const pts = [];
      for (let k = -8; k <= 8; k++) {
        const u = k / 8;
        pts.push([ex + u * 5.6, ey + 1.5 - 4 * (1 - u * u)]);
      }
      r.polyline(pts, C.ink, 1.5);
    } else if (type === "flat") {
      const pts = [];
      for (let k = -8; k <= 8; k++) {
        const u = k / 8;
        pts.push([ex + u * 5.4, ey + 0.2 + 0.9 * u * u]);
      }
      r.polyline(pts, C.ink, 1.7);
      r.ellipse(ex, ey + 2.1, 1.7, 0.7, C.irisM);
    } else if (type === "shout") {
      // 「＞ ＜」(左目が ＞、右目が ＜)
      const sx = -side;
      r.polyline([[ex + sx * 3.8, ey - 3.4], [ex - sx * 3.6, ey], [ex + sx * 3.8, ey + 3.4]], C.ink, 1.5);
    } else if (type === "closed") {
      const pts = [];
      for (let k = -8; k <= 8; k++) {
        const u = k / 8;
        pts.push([ex + u * 5.4, ey + 2 - 2.2 * u * u]);
      }
      r.polyline(pts, C.ink, 1.5);
    }
  }

  /* ---- まゆ: ちいさく。怒り顔にならない角度だけ ---- */
  drawBrows(r, m, fx, fy) {
    for (const side of [-1, 1]) {
      const x0 = fx(40 + side * 8);
      const x1 = fx(40 + side * 14);
      const y = fy(34.5) + m.browY;
      const yi = y + m.browTilt * -1.2;
      const yo = y + m.browTilt * 1.0;
      r.line(x0, yi, x1, yo, C.hairD, 0.8);
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
      r.ellipse(mx, my, rx + 0.8, ry + 0.8, C.lipD);
      r.ellipse(mx, my, rx, ry, (x, y) => lerpC(C.mouthIn, C.mouthIn, 0));
      if (h >= 4) r.ellipse(mx, my + ry * 0.5, rx * 0.8, ry * 0.5, C.tongue);
    } else if (type === "smile") {
      // 大きく笑った口(上は平ら、下がまるい)。歯は描かない
      const half = w / 2;
      const top = my - h / 2;
      const shape = (pad) => (yc) => {
        const t = (yc - top) / h;
        if (yc < top - pad || t > 1 + pad / h) return null;
        const hw = t <= 0 ? half : half * Math.sqrt(Math.max(0, 1 - t * t));
        return [mx - hw - pad, mx + hw + pad];
      };
      r.rows(top - 0.8, my + h / 2 + 0.8, shape(0.8), C.lipD);
      r.rows(top, my + h / 2, shape(0), C.mouthIn);
      r.ellipse(mx, my + h * 0.55, half * 0.55, h * 0.32, C.tongue);
    } else if (type === "flat") {
      const half = w / 2;
      const sup = (pad) => (yc) => {
        const t = Math.abs((yc - my) / (h / 2 + pad));
        if (t > 1) return null;
        const hw = (half + pad) * Math.pow(1 - Math.pow(t, 3), 1 / 3);
        return [mx - hw, mx + hw];
      };
      r.rows(my - h / 2 - 0.8, my + h / 2 + 0.8, sup(0.8), C.lipD);
      r.rows(my - h / 2, my + h / 2, sup(0), (x, y) => (y > my + h * 0.1 ? C.tongue : C.mouthIn));
    } else if (type === "pucker") {
      const rr = Math.max(2, w / 2);
      r.ellipse(mx, my, rr + 1.3, rr + 1.3, C.lip);
      r.ellipse(mx, my, rr - 0.3, rr - 0.3, C.mouthIn);
      r.ellipse(mx, my + 0.6, 0.8, 0.6, C.tongue);
    }
    if (singing) r.ellipse(mx + w / 2 + 3, my - 3, 0.6, 0.6, C.spark);
  }

  /* ---- 前髪: ぱっつんにまるい毛先 ---- */
  drawFringe(r, cx, cy, fw, fh) {
    const hw = this.headHW;
    const topY = cy - 27 * fh;
    const R = 27.5 * fw;
    const base = cy - 11 * fh;
    const tip = (x) => {
      const d = Math.abs(x - cx);
      const wave = Math.abs(Math.sin(((x - cx) * Math.PI) / (9 * fw)));
      const part = d < 2 ? -3 + d * 1.2 : 0; // 真ん中のわけ目
      const sweep = Math.min(1, d / (22 * fw));
      return base + 5 * wave * (1 - sweep * 0.4) - sweep * sweep * 6 + part;
    };
    const x0 = Math.floor((cx - R) * S);
    const x1 = Math.ceil((cx + R) * S);
    const tips = [];
    for (let X = x0; X <= x1; X++) tips[X - x0] = tip((X + 0.5) / S);
    for (let Y = Math.floor(topY * S); Y <= Math.ceil((cy + 10) * S); Y++) {
      const yc = (Y + 0.5) / S;
      const w = hw(yc);
      for (let X = x0; X <= x1; X++) {
        const xc = (X + 0.5) / S;
        const u = (xc - cx) / R;
        if (Math.abs(u) > 1) continue;
        if (yc < cy - 4 - 25 * fh * Math.sqrt(1 - u * u)) continue;
        const tp = tips[X - x0];
        const inFringe = yc < tp;
        // サイドの髪(顔の縁にそって下りる)
        const dx = Math.abs(xc - cx);
        const side = w > 0 && dx > w - 2.6 && dx < w + 3 && yc < cy + 9;
        if (!inFringe && !side) continue;
        // 毛先の少し内側を濃くして、毛束の厚みを出す
        const edge = inFringe && yc > tp - 0.9;
        r.put(X, Y, edge ? C.hairD : C.hair);
      }
    }
    // 毛束の筋(うすい影)
    for (const dx of [-14, -7, 7, 14]) {
      const x = cx + dx * fw;
      r.line(x, topY + 4.5, x + Math.sign(dx) * 0.6, tip(x) - 1.5, C.hairD, 0.35);
    }
    // てっぺんのつや(天使の輪)
    const ring = [];
    for (let k = -10; k <= 10; k++) {
      const u = k / 10;
      const x = cx + u * 15 * fw;
      const y = cy - 4 - 25 * fh * Math.sqrt(1 - Math.pow((x - cx) / R, 2)) + 4.2 + u * u * 2;
      ring.push([x, y]);
    }
    r.polyline(ring, C.hairL, 0.95);
    r.polyline(ring.slice(5, 14), C.hairLL, 0.5);
  }

  /* ---- 効果(マンガ記号) ---- */
  drawFx(r, m, fx, fy) {
    const d = m.dom;
    if (m.domW < 0.6) return;
    const col = C.spark;
    if (d === "i") {
      const sp = (x, y) => {
        r.line(x - 1.6, y, x + 1.6, y, col, 0.5);
        r.line(x, y - 1.6, x, y + 1.6, col, 0.5);
        r.ellipse(x, y, 0.5, 0.5, col);
      };
      sp(fx(40 - 28), fy(30));
      sp(fx(40 + 28), fy(34));
    } else if (d === "u") {
      for (const side of [-1, 1]) {
        const x = fx(40 + side * 26) + side * 3;
        r.polyline([[x, fy(46)], [x - side * 2, fy(49)], [x, fy(52)]], col, 0.6);
      }
    } else if (d === "e") {
      r.ellipse(fx(40 - 24), fy(32.4), 1.4, 2.0, C.sweat);
      r.poly([[fx(40 - 24), fy(28.6)], [fx(40 - 24) - 1.1, fy(31)], [fx(40 - 24) + 1.1, fy(31)]], C.sweat);
    } else if (d === "o") {
      for (const side of [-1, 1]) {
        const x = 40 + side * 31;
        r.line(x, fy(32), x + side * 3, fy(29), col, 0.6);
        r.line(x + side, fy(38), x + side * 5, fy(38), col, 0.6);
      }
    }
  }
}

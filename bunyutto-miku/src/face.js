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
/* すべて連続値。指の動かした量に応じて、母音ごとの値が重みで混ざる。      */
/*   fw/fh=顔の幅・高さ  pull=ほっぺ  browY/browTilt=眉  blush=頬紅       */
/*   eye: open=ひらき(1=まるい目,0=閉じた線) size=大きさ                  */
/*        bow=閉じた線の反り(+で上に凸=にっこり、-でたれ目) yoff=線の高さ  */
/*        chev=「＞ ＜」への変形量                                        */
/*   mouth: w/h=大きさ y=中心の高さ p=上辺の平らさ(0=楕円,1=上が平ら)     */
/*        n=角の立ち(2=丸,3=四角寄り) pad=くちびるの太さ                  */
/*        tg=舌(dy,rx,ry は口の大きさに対する比)                          */
/* ------------------------------------------------------------------ */
export const EXPR = {
  // あ: さわっただけ。にこにこで、小さく口をあけている
  a: { fw: 1.0, fh: 1.0, pull: 0.0, browY: 0, browTilt: 0.0, blush: 0.6,
       eye: { open: 1, size: 1, bow: 0, yoff: 0, chev: 0 },
       mouth: { w: 6, h: 5, y: 54, p: 0, n: 2, pad: 0.8, tg: { dy: 0.25, rx: 0.8, ry: 0.25 } } },
  // い: ほっぺを横にのばされて、むにーっと笑顔。目はにっこり弧
  i: { fw: 1.14, fh: 0.95, pull: 1.0, browY: -1, browTilt: 0.0, blush: 1.0,
       eye: { open: 0, size: 1, bow: 4, yoff: 1.5, chev: 0 },
       mouth: { w: 17, h: 8, y: 54, p: 1, n: 2, pad: 0.8, tg: { dy: 0.42, rx: 0.5, ry: 0.3 } } },
  // う: 両側から押さえられて、ほっぺがぷくっ。口はちゅっと小さな丸
  u: { fw: 0.9, fh: 1.03, pull: -1.0, browY: 0, browTilt: -0.4, blush: 1.0,
       eye: { open: 1, size: 1.12, bow: 0, yoff: 0, chev: 0 },
       mouth: { w: 4, h: 4, y: 54, p: 0, n: 2, pad: 1.3, tg: { dy: 0.2, rx: 0.2, ry: 0.15 } } },
  // え: たてに押しつぶされて、むぎゅっ。口は横にきゅっと開く
  e: { fw: 1.1, fh: 0.88, pull: 0.5, browY: 1, browTilt: -0.3, blush: 0.8,
       eye: { open: 0, size: 1, bow: -0.9, yoff: 1.1, chev: 0 },
       mouth: { w: 13, h: 4, y: 54, p: 0, n: 3, pad: 0.8, tg: { dy: 0.25, rx: 0.8, ry: 0.35 } } },
  // お: たてにのばされ、Oの口で元気に歌う。目はぎゅっと閉じた「＞ ＜」
  o: { fw: 0.94, fh: 1.12, pull: 0.0, browY: -2, browTilt: 0.0, blush: 0.7,
       eye: { open: 0, size: 1, bow: 0, yoff: 0, chev: 1 },
       mouth: { w: 10, h: 12, y: 55, p: 0, n: 2, pad: 0.8, tg: { dy: 0.25, rx: 0.8, ry: 0.25 } } },
};
const VOWEL_KEYS = ["a", "i", "u", "e", "o"];

/** 重み w(合計1)で、すべてのパラメータを連続的に混ぜる(型の切り替えは無い) */
export function mixExpr(w) {
  const m = {
    fw: 0, fh: 0, pull: 0, browY: 0, browTilt: 0, blush: 0,
    eye: { open: 0, size: 0, bow: 0, yoff: 0, chev: 0 },
    mouth: { w: 0, h: 0, y: 0, p: 0, n: 0, pad: 0, tg: { dy: 0, rx: 0, ry: 0 } },
    w: {},
  };
  let sum = 0;
  for (const k of VOWEL_KEYS) sum += w[k] || 0;
  for (const k of VOWEL_KEYS) {
    const wk = (w[k] || 0) / (sum || 1);
    m.w[k] = wk;
    const e = EXPR[k];
    m.fw += e.fw * wk; m.fh += e.fh * wk; m.pull += e.pull * wk;
    m.browY += e.browY * wk; m.browTilt += e.browTilt * wk; m.blush += e.blush * wk;
    for (const q of Object.keys(m.eye)) m.eye[q] += e.eye[q] * wk;
    for (const q of ["w", "h", "y", "p", "n", "pad"]) m.mouth[q] += e.mouth[q] * wk;
    for (const q of ["dy", "rx", "ry"]) m.mouth.tg[q] += e.mouth.tg[q] * wk;
  }
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
      ...VOWEL_KEYS.map((k) => Math.round((w[k] || 0) * 48)),
      Math.round((s.blink || 0) * 8),
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

  /* ---- 目: まるい目 → にっこり弧 / 線 / 「＞ ＜」へ、形そのものが連続して変わる ---- */
  drawEyes(r, m, fx, fy, blink) {
    const e = { ...m.eye };
    // まばたき: 閉じた線(ふせたまつ毛の弧)へ滑らかに
    const bl = Math.max(0, Math.min(1, blink)) * e.open;
    e.open *= 1 - blink;
    e.bow = e.bow * (1 - bl) + -2.2 * bl;
    e.yoff = e.yoff * (1 - bl) + -0.2 * bl;
    for (const side of [-1, 1]) {
      this.drawEye(r, e, fx(40 + side * 11.2), fy(43.5), side);
    }
  }

  drawEye(r, e, ex, ey, side) {
    const rx = 5.4 * e.size;
    const ry = 6.6 * e.size;
    const open = Math.max(0, Math.min(1, e.open));
    const closed = 1 - open;
    const N = 16;
    // まぶたの線: ひらいているときは目の上の縁、閉じるにつれて「反った線」へ
    const bowY = (u) => e.yoff - e.bow * (1 - u * u);
    const lidY = (u) => ey - ry * open * Math.sqrt(Math.max(0, 1 - u * u)) - 0.5 * open + closed * bowY(u);
    const lid = [];
    for (let k = 0; k <= N; k++) {
      const u = (k / N) * 2 - 1;
      lid.push([ex + u * (rx + 0.2 * open), lidY(u)]);
    }
    // 「＞ ＜」への変形(左目が ＞、右目が ＜)。線の両端が上下の先端、中央が頂点になる
    const sx = side;
    const chev = Math.max(0, Math.min(1, e.chev));
    const cp = [[ex + sx * 3.8, ey - 3.4], [ex - sx * 3.6, ey], [ex + sx * 3.8, ey + 3.4]];
    const chevAt = (t) => (t < 0.5
      ? [cp[0][0] + (cp[1][0] - cp[0][0]) * (t * 2), cp[0][1] + (cp[1][1] - cp[0][1]) * (t * 2)]
      : [cp[1][0] + (cp[2][0] - cp[1][0]) * (t * 2 - 1), cp[1][1] + (cp[2][1] - cp[1][1]) * (t * 2 - 1)]);
    // 目玉(虹彩)は、ひらき具合に応じて縦に縮む。ほぼ閉じたら出さない
    if (open > 0.04) {
      const top = lidY(0);
      const bottom = ey + ry * (0.1 + 0.9 * open) * (1 - chev);
      const H = Math.max(0.1, bottom - top);
      const cy2 = top + H / 2;
      const ry2 = H / 2;
      const rx2 = rx * (0.55 + 0.45 * Math.sqrt(open));
      r.ellipse(ex, cy2, rx2 + 0.7, ry2 + 0.7, C.ink);
      r.ellipse(ex, cy2, rx2, ry2, (x, y) => {
        const t = (y - cy2) / ry2;
        return t < 0.1 ? lerpC(C.irisD, C.irisM, smooth(-1, 0.1, t)) : lerpC(C.irisM, C.irisL, smooth(0.1, 0.95, t));
      });
      const pk = smooth(0.15, 0.6, open);
      r.ellipse(ex, cy2 + ry2 * 0.06, rx2 * 0.46 * pk, ry2 * 0.5 * pk, C.pupil);
      // ハイライトも、ひらきに合わせて少しずつ現れる
      const hk = smooth(0.35, 0.9, open);
      if (hk > 0.02) {
        r.ellipse(ex - side * 1.9 * e.size + 0.3, cy2 - ry2 * 0.36, 1.7 * hk, 1.8 * hk, C.spark);
        r.ellipse(ex + side * 2.4, cy2 + ry2 * 0.45, 0.7 * hk, 0.7 * hk, C.spark);
        r.ellipse(ex + side * 3.3, cy2 + ry2 * 0.27, 0.45 * hk, 0.45 * hk, C.spark);
      }
    }
    // 線(まぶた/にっこり弧/＞＜)。太さも連続して変わる
    const wLine = 1.3 + 0.3 * closed + 0.2 * chev;
    const pts = lid.map((p, k) => {
      if (chev <= 0) return p;
      const c = chevAt(k / N);
      return [p[0] + (c[0] - p[0]) * chev, p[1] + (c[1] - p[1]) * chev];
    });
    r.polyline(pts, C.ink, wLine);
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

  /* ---- 口: 楕円 → 上が平らな笑顔 → 四角い口 → 小さなすぼめ口、まで連続して変わる ---- */
  drawMouth(r, m, fx, fy, singing) {
    const g = m.mouth;
    const mx = fx(40);
    const w = Math.max(3, g.w);
    const h = Math.max(2, g.h);
    const half = w / 2;
    const my = fy(g.y);
    const top = my - h / 2;
    // 縦位置 v(0..1) での半幅。p=1 で上辺が平ら(上が広い)、n が大きいほど角ばる
    const hwAt = (yc, pad) => {
      const v = (yc - top) / h;
      if (v < -pad / h || v > 1 + pad / h) return null;
      const vv = Math.max(0, Math.min(1, v));
      const round = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * vv - 1), g.n)), 1 / g.n);
      const half2 = Math.sqrt(Math.max(0, 1 - vv * vv)); // 上が平らな(半楕円)
      const f = round + (half2 - round) * g.p;
      return half * f + pad;
    };
    const shape = (pad) => (yc) => {
      const hw = hwAt(yc, pad);
      return hw == null ? null : [mx - hw, mx + hw];
    };
    // くちびる: すぼめるほど太く明るい色に
    const ring = lerpC(C.lipD, C.lip, Math.min(1, (g.pad - 0.8) / 0.5));
    r.rows(top - g.pad, my + h / 2 + g.pad, shape(g.pad), ring);
    r.rows(top, my + h / 2, shape(0), C.mouthIn);
    // 舌: 口の大きさに応じて、小さい口ではしぼむ
    const tk = smooth(2.5, 5, h) * smooth(2.5, 5, w);
    if (tk > 0.02) {
      r.ellipse(mx, my + h * (g.tg.dy - 0.0), half * g.tg.rx * tk, h * g.tg.ry * tk, C.tongue);
    }
    if (singing) r.ellipse(mx + half + 3, my - 3, 0.6, 0.6, C.spark);
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

  /* ---- 効果(マンガ記号): 母音の重みに応じて大きさが連続して変わる ---- */
  drawFx(r, m, fx, fy) {
    const col = C.spark;
    const wi = smooth(0.2, 0.85, m.w.i);
    if (wi > 0.04) {
      const sp = (x, y) => {
        const k = 1.6 * wi;
        r.line(x - k, y, x + k, y, col, 0.5);
        r.line(x, y - k, x, y + k, col, 0.5);
        r.ellipse(x, y, 0.5 * wi, 0.5 * wi, col);
      };
      sp(fx(40 - 28), fy(30));
      sp(fx(40 + 28), fy(34));
    }
    const wu = smooth(0.2, 0.85, m.w.u);
    if (wu > 0.04) {
      for (const side of [-1, 1]) {
        const x = fx(40 + side * 26) + side * 3;
        const k = wu;
        r.polyline([[x, fy(49 - 3 * k)], [x - side * 2 * k, fy(49)], [x, fy(49 + 3 * k)]], col, 0.6);
      }
    }
    const we = smooth(0.2, 0.85, m.w.e);
    if (we > 0.04) {
      const x = fx(40 - 24);
      r.ellipse(x, fy(32.4), 1.4 * we, 2.0 * we, C.sweat);
      r.poly([[x, fy(32.4 - 3.8 * we)], [x - 1.1 * we, fy(31)], [x + 1.1 * we, fy(31)]], C.sweat);
    }
    const wo = smooth(0.2, 0.85, m.w.o);
    if (wo > 0.04) {
      for (const side of [-1, 1]) {
        const x = 40 + side * 31;
        r.line(x, fy(32), x + side * 3 * wo, fy(32 - 3 * wo), col, 0.6);
        r.line(x + side, fy(38), x + side * (1 + 4 * wo), fy(38), col, 0.6);
      }
    }
  }
}

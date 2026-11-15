// ドット絵のミクの顔。320×320 ドット(論理80×80の4倍)、固定パレット、アンチエイリアス無し。
//
// 顔のデザイン(色・形・各母音の表情・髪・動き)は、すべて
//   app/data/design/miku-face.json
// に置いてある。このファイルは、そのデザインデータを読んで描くだけ。
// デザインを変えるときは JSON を編集する(コードは触らない)。意味は design/README.md。
//
// 丸くて小さな目と口のシンプルな「ちびミク」。怖く見えないこと = 可愛さが最優先
// (鋭いまつ毛・歯・濃い輪郭線は使わない)。
// 顔は「5つの表情の重み」で決まる。あ(ふつう) い(横にのばす) う(横からおさえる)
// え(たてにつぶす) お(たてにのばす=Oの口)。重みから、顔の幅・高さ・ほっぺ・眉・
// 目の開き・口の大きさなどを連続的に混ぜる(型の切り替えは無い)。
// 表情を足すには、JSON の expressions に1つ足す。

// 論理座標は 80×80(描画コードはこの単位で書く)。実解像度はその S 倍。
// S=4 → 320×320 ドット。表示時に滑らかに拡大するので、ドットは一見わからない細かさになる。
export const FACE_LOGICAL = 80;
export const FACE_S = 4;
export const FACE_W = FACE_LOGICAL * FACE_S;
export const FACE_H = FACE_LOGICAL * FACE_S;
const S = FACE_S;

export const VOWEL_KEYS = ["a", "i", "u", "e", "o"];

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return (255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255);
}

/* ------------------------------------------------------------------ */
/* デザインデータの読み込みと検証                                        */
/* ------------------------------------------------------------------ */
const PALETTE_KEYS = [
  "hair", "hairD", "hairDD", "hairL", "hairLL", "skin", "skinS", "skinSS", "outline", "blush", "blush2",
  "ink", "white", "irisD", "irisM", "irisL", "pupil", "mouthIn", "tongue", "teeth", "lip", "lipD", "lipHi",
  "shirt", "shirtS", "sleeve", "sleeveL", "tie", "tieD", "gear", "gearL", "gearT", "spark", "sweat", "handLine", "handShade",
];
const SECTIONS = ["palette", "head", "eyes", "brows", "blush", "mouth", "hair", "headphones", "body", "fx", "motion", "expressions"];
const EXPR_FIELDS = ["fw", "fh", "pull", "browY", "browTilt", "blush"];
const EYE_FIELDS = ["open", "size", "bow", "yoff", "chev"];
const MOUTH_FIELDS = ["w", "h", "y", "p", "n", "pad", "wrinkle", "shine"];
const TG_FIELDS = ["dy", "rx", "ry"];

/** デザインデータを検証する。問題があれば、場所つきのメッセージで例外を投げる。 */
export function validateDesign(d) {
  const errs = [];
  const num = (v, path) => {
    if (typeof v !== "number" || !Number.isFinite(v)) errs.push(path + " は数値にしてください(現在: " + JSON.stringify(v) + ")");
  };
  if (!d || typeof d !== "object") throw new Error("デザインデータが空、またはオブジェクトではありません");
  for (const s of SECTIONS) if (!d[s] || typeof d[s] !== "object") errs.push("セクション " + s + " がありません");
  if (errs.length) throw new Error(errs.join("\n"));
  for (const k of PALETTE_KEYS) {
    if (typeof d.palette[k] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(d.palette[k])) errs.push("palette." + k + " は #RRGGBB の色にしてください(現在: " + JSON.stringify(d.palette[k]) + ")");
  }
  for (const k of VOWEL_KEYS) {
    const e = d.expressions[k];
    if (!e) { errs.push("expressions." + k + " がありません(あいうえお の5つが必要)"); continue; }
    for (const f of EXPR_FIELDS) num(e[f], "expressions." + k + "." + f);
    for (const f of EYE_FIELDS) num(e.eye && e.eye[f], "expressions." + k + ".eye." + f);
    for (const f of MOUTH_FIELDS) num(e.mouth && e.mouth[f], "expressions." + k + ".mouth." + f);
    for (const f of TG_FIELDS) num(e.mouth && e.mouth.tg && e.mouth.tg[f], "expressions." + k + ".mouth.tg." + f);
  }
  // 数値は、使う場所で必ず参照されるものを一通り確かめる(欠けると NaN で絵が壊れるため)
  const need = {
    head: ["cx", "cy", "rx", "ry", "chinTaper", "outlineWidth"],
    eyes: ["size", "dx", "y", "rx", "ry", "outlinePad"],
    brows: ["x0", "x1", "y", "width", "tiltInner", "tiltOuter"],
    blush: ["x", "y", "rx", "ry", "rxGain", "ryGain", "minAmount"],
    mouth: ["minW", "minH", "ringBase", "ringRange"],
    headphones: ["y", "rx", "ry", "offset"],
    motion: ["weightSmoothSec", "beatBounce", "bounceFollow"],
  };
  for (const [sec, keys] of Object.entries(need)) for (const k of keys) num(d[sec][k], sec + "." + k);
  for (const k of ["shirt", "sleeve", "neckline", "tie", "tieShade"]) {
    if (!Array.isArray(d.body[k]) || d.body[k].some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) errs.push("body." + k + " は [[x,y],...] にしてください");
  }
  if (!Array.isArray(d.hair.tails && d.hair.tails.points) || d.hair.tails.points.length < 3) errs.push("hair.tails.points は3点以上の [x,y,揺れ係数] にしてください");
  if (!d.hair.fringe || !d.hair.back) errs.push("hair.back / hair.fringe がありません");
  const hd = d.fx && d.fx.hands;
  if (!hd) errs.push("fx.hands がありません");
  else {
    for (const k of ["y", "inset", "slide", "tilt", "outline"]) num(hd[k], "fx.hands." + k);
    for (const [g, ks] of Object.entries({ palm: ["len", "w"], finger: ["n", "w", "len", "spacing", "fan"], thumb: ["w", "len", "dy", "dxIn"], arm: ["w", "toX", "toY"] })) {
      for (const k of ks) num(hd[g] && hd[g][k], "fx.hands." + g + "." + k);
    }
    if (!Array.isArray(hd.ramp) || hd.ramp.length !== 2) errs.push("fx.hands.ramp は [始め, 満量] にしてください");
  }
  const pf = d.head.cheek && d.head.cheek.puff;
  if (!pf) errs.push("head.cheek.puff がありません");
  else for (const k of ["dy", "height", "amount"]) num(pf[k], "head.cheek.puff." + k);
  for (const k of ["count", "inner", "outer", "width"]) num(d.mouth.wrinkle && d.mouth.wrinkle[k], "mouth.wrinkle." + k);
  for (const k of ["dx", "dy", "r"]) num(d.mouth.shine && d.mouth.shine[k], "mouth.shine." + k);
  if (errs.length) throw new Error("デザインデータの問題:\n" + errs.join("\n"));
  return d;
}

let D = null;
let C = {};
let designVersion = 0;

/** デザインデータを設定する(検証つき)。以降の描画はこれを使う。 */
export function setDesign(d) {
  validateDesign(d);
  D = d;
  C = {};
  for (const k of PALETTE_KEYS) C[k] = hex(d.palette[k]);
  designVersion++;
  return D;
}

/** URL からデザインデータを読み込む(キャッシュさせない) */
export async function loadDesign(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error("デザインデータの取得に失敗: " + url + " → HTTP " + r.status);
  return setDesign(await r.json());
}

export function getDesign() {
  return D;
}

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
/* 表情の混ぜ合わせ                                                      */
/* ------------------------------------------------------------------ */
/** 重み w(合計1)で、すべてのパラメータを連続的に混ぜる(型の切り替えは無い) */
export function mixExpr(w) {
  const EXPR = D.expressions;
  const m = {
    fw: 0, fh: 0, pull: 0, browY: 0, browTilt: 0, blush: 0,
    eye: { open: 0, size: 0, bow: 0, yoff: 0, chev: 0 },
    mouth: { w: 0, h: 0, y: 0, p: 0, n: 0, pad: 0, wrinkle: 0, shine: 0, tg: { dy: 0, rx: 0, ry: 0 } },
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
    for (const q of ["w", "h", "y", "p", "n", "pad", "wrinkle", "shine"]) m.mouth[q] += e.mouth[q] * wk;
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
    if (!D) throw new Error("顔のデザインデータが未読み込みです(loadDesign か setDesign を先に呼んでください)");
    const w = s.w || { a: 1 };
    const mo = D.motion;
    const sway = Math.round((Math.sin((s.t || 0) * mo.sway.period) * mo.sway.amp + (s.beat || 0) * mo.sway.beat) * 6) / 6;
    // 見た目が変わらないフレームは描き直さない(高解像度なので重い)
    const key = [
      designVersion,
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
    const bounce = (s.beat || 0) * mo.beatBounce;
    const fw = m.fw;
    const fh = m.fh;
    const cx = D.head.cx;
    const cy = D.head.cy + bounce * mo.bounceFollow;
    const fx = (x) => cx + (x - D.head.cx) * fw;
    const fy = (y) => cy + (y - D.head.cy) * fh;

    this.drawBackHair(r, cx, cy, sway); // 髪はピンチで変形しない
    this.drawBody(r, cx, cy);
    this.drawHead(r, m, cx, cy, fw, fh);
    this.drawBlush(r, m, fx, fy);
    this.drawEyes(r, m, fx, fy, s.blink || 0);
    this.drawMouth(r, m, fx, fy, s.singing);
    this.drawFringe(r, cx, cy);
    this.drawBrows(r, m, fx, fy);
    this.drawHeadphones(r, cx, cy);
    this.drawFx(r, m, fx, fy);
    this.drawHands(r, m, cx, fy);

    if (this.ctx) {
      new Uint32Array(this.imageData.data.buffer).set(r.px);
      this.ctx.putImageData(this.imageData, 0, 0);
    }
  }

  /** デザインを差し替えたあと、強制的に描き直す */
  invalidate() {
    this.lastKey = "";
  }

  /* ---- 後ろ髪 + ちびツインテール ---- */
  drawBackHair(r, cx, cy, sway) {
    const H = D.hair;
    const T = H.tails;
    for (const side of [-1, 1]) {
      const pts = T.points.map((p) => [cx + side * (p[0] + sway * p[2]), cy + p[1]]);
      r.stroke(pts.map((p) => [p[0] + side * T.shadow.dx, p[1]]), T.shadow.r0, T.shadow.r1, C.hairD);
      r.stroke(pts, T.body.r0, T.body.r1, (u) => lerpC(C.hair, C.hairD, smooth(T.body.shadeFrom, 1, u) * T.body.shadeAmount));
      r.stroke(pts.map((p) => [p[0] - side * T.gloss.dx, p[1] + T.gloss.dy]), T.gloss.r0, T.gloss.r1, C.hairL);
      r.stroke(pts.map((p) => [p[0] - side * T.glossHi.dx, p[1] + T.glossHi.dy]), T.glossHi.r0, T.glossHi.r1, C.hairLL);
      // 毛束の筋
      for (const o of T.streaks.offsets) {
        r.polyline(pts.slice(1).map((p) => [p[0] + side * o, p[1]]), C.hairD, T.streaks.width);
      }
      // ヘアゴム
      const bx = cx + side * T.tie.x;
      const by = cy + T.tie.y;
      r.ellipse(bx + side * T.tie.dx, by, T.tie.r, T.tie.r, C.gear);
      r.ellipse(bx + side * T.tie.dx + T.tie.hi.dx, by + T.tie.hi.dy, T.tie.hi.r, T.tie.hi.r, C.gearL);
    }
    r.ellipse(cx, cy + H.back.dy, H.back.rx, H.back.ry, C.hair);
  }

  /* ---- 首・小さな肩・ネクタイ ---- */
  drawBody(r, cx, cy) {
    const B = D.body;
    const P = (pts) => pts.map((p) => [cx + p[0], p[1]]);
    const top = cy + B.neck.topDy;
    r.rows(top, B.neck.bottom, () => [cx - B.neck.half, cx + B.neck.half], C.skinS);
    const sh = B.shirtShade;
    r.poly(P(B.shirt), (x, y) => lerpC(C.shirt, C.shirtS, smooth(sh.from, sh.to, y) * sh.amount));
    r.poly(P(B.sleeve), C.sleeve);
    r.poly(P(B.sleeve.map((p) => [-p[0], p[1]])), C.sleeve);
    r.poly(P(B.neckline), C.skinS);
    r.poly(P(B.tie), C.tie);
    r.poly(P(B.tieShade), C.tieD);
  }

  /* ---- 顔: 丸い ---- */
  drawHead(r, m, cx, cy, fw, fh) {
    const Hd = D.head;
    const ry = Hd.ry * fh;
    // 顔の輪郭(半幅)。ほっぺ: 引っ張ると外へふくらむ(尖らせず、おもちのように丸く)。押さえるとへこむ
    const outline = (fw_, fh_, pull) => (yc) => {
      const rx_ = Hd.rx * fw_;
      const ry_ = Hd.ry * fh_;
      const t = (yc - cy) / ry_;
      if (Math.abs(t) > 1) return -1;
      let w = rx_ * Math.sqrt(1 - t * t);
      if (t > 0) w *= 1 - Hd.chinTaper * t * t; // あごはまるく
      const bump = Math.max(0, 1 - Math.pow((yc - (cy + Hd.cheek.y * fh_)) / (Hd.cheek.height * fh_), 2));
      w += pull * (pull > 0 ? Hd.cheek.bulgeOut : Hd.cheek.bulgeIn) * bump;
      if (pull < 0) {
        // 手で押さえられた頬は、押された所がへこみ、その上と下がふくらむ
        const pf = Hd.cheek.puff;
        for (const sg of [-1, 1]) {
          const bp = Math.max(0, 1 - Math.pow((yc - (cy + (Hd.cheek.y + sg * pf.dy) * fh_)) / (pf.height * fh_), 2));
          w += -pull * pf.amount * bp;
        }
      }
      return w;
    };
    const hw = outline(fw, fh, m.pull);
    // 髪・ヘッドホンはピンチで変形しない。それらが沿う「ふだんの輪郭」を別に持つ
    this.neutralHW = outline(1, 1, 0);
    const rowsFn = (yc) => {
      const w = hw(yc);
      return w < 0 ? null : [cx - w, cx + w];
    };
    // 肌: あご下に向かってやわらかく影になる
    r.rows(cy - ry, cy + ry, rowsFn, (x, y) => lerpC(C.skin, C.skinS, smooth(Hd.shade.from, Hd.shade.to, (y - cy) / ry)));
    // 輪郭はうすい肌色の線だけ
    const ow = Hd.outlineWidth;
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
    this.headHW = hw;
    this.headRy = ry;
  }

  /* ---- ヘッドホン(耳) ---- */
  drawHeadphones(r, cx, cy) {
    const P = D.headphones;
    const hw = this.neutralHW;
    for (const side of [-1, 1]) {
      const y = cy + P.y;
      const ex = cx + side * (hw(y) + P.offset);
      r.ellipse(ex, y, P.rx, P.ry, C.gear);
      r.ellipse(ex + side * P.hi.dx, y + P.hi.dy, P.hi.rx, P.hi.ry, C.gearL);
      r.ellipse(ex + side * P.accent.dx, y + P.accent.dy, P.accent.rx, P.accent.ry, C.gearT);
    }
  }

  drawBlush(r, m, fx, fy) {
    const B = D.blush;
    const a = Math.max(B.minAmount, Math.min(1, m.blush));
    for (const side of [-1, 1]) {
      const bx = fx(D.head.cx + side * B.x);
      const by = fy(B.y);
      const rx = B.rx + a * B.rxGain;
      const ry = B.ry + a * B.ryGain;
      // 中心ほど濃い、ふんわりした頬紅
      r.rows(by - ry, by + ry, (yc) => {
        const t = (yc - by) / ry;
        if (Math.abs(t) > 1) return null;
        const hw = rx * Math.sqrt(1 - t * t);
        return [bx - hw, bx + hw];
      }, (x, y) => {
        const d = Math.hypot((x - bx) / rx, (y - by) / ry);
        return lerpC(C.blush, C.blush2, smooth(B.fade[0], B.fade[1], d));
      });
    }
  }

  /* ---- 目: まるい目 → にっこり弧 / 線 / 「＞ ＜」へ、形そのものが連続して変わる ---- */
  drawEyes(r, m, fx, fy, blink) {
    const E = D.eyes;
    const e = { ...m.eye };
    // まばたき: 閉じた線(ふせたまつ毛の弧)へ滑らかに
    const bl = Math.max(0, Math.min(1, blink)) * e.open;
    e.open *= 1 - blink;
    e.bow = e.bow * (1 - bl) + E.blink.bow * bl;
    e.yoff = e.yoff * (1 - bl) + E.blink.yoff * bl;
    for (const side of [-1, 1]) {
      this.drawEye(r, e, fx(D.head.cx + side * E.dx), fy(E.y), side);
    }
  }

  drawEye(r, e, ex, ey, side) {
    const E = D.eyes;
    const EYE_K = E.size; // 目の大きさ(1.0=初版)
    const rx = E.rx * e.size * EYE_K;
    const ry = E.ry * e.size * EYE_K;
    const open = Math.max(0, Math.min(1, e.open));
    const closed = 1 - open;
    const N = E.lid.steps;
    // まぶたの線: ひらいているときは目の上の縁、閉じるにつれて「反った線」へ
    const bowY = (u) => e.yoff - e.bow * (1 - u * u);
    const lidY = (u) => ey - ry * open * Math.sqrt(Math.max(0, 1 - u * u)) - E.lid.lift * open + closed * bowY(u);
    const lid = [];
    for (let k = 0; k <= N; k++) {
      const u = (k / N) * 2 - 1;
      lid.push([ex + u * (rx + E.lid.overhang * open), lidY(u)]);
    }
    // 「＞ ＜」への変形(左目が ＞、右目が ＜)。線の両端が上下の先端、中央が頂点になる
    const sx = side;
    const chev = Math.max(0, Math.min(1, e.chev));
    const CV = E.chevron;
    const cp = [[ex + sx * CV.tipX * EYE_K, ey - CV.tipY * EYE_K], [ex - sx * CV.innerX * EYE_K, ey], [ex + sx * CV.tipX * EYE_K, ey + CV.tipY * EYE_K]];
    const chevAt = (t) => (t < 0.5
      ? [cp[0][0] + (cp[1][0] - cp[0][0]) * (t * 2), cp[0][1] + (cp[1][1] - cp[0][1]) * (t * 2)]
      : [cp[1][0] + (cp[2][0] - cp[1][0]) * (t * 2 - 1), cp[1][1] + (cp[2][1] - cp[1][1]) * (t * 2 - 1)]);
    // 目玉(虹彩)は、ひらき具合に応じて縦に縮む。ほぼ閉じたら出さない
    const I = E.iris;
    if (open > I.minOpen) {
      const top = lidY(0);
      const bottom = ey + ry * (I.bottomBase + I.bottomGain * open) * (1 - chev);
      const Hh = Math.max(0.1, bottom - top);
      const cy2 = top + Hh / 2;
      const ry2 = Hh / 2;
      const rx2 = rx * (I.widthBase + I.widthGain * Math.sqrt(open));
      r.ellipse(ex, cy2, rx2 + E.outlinePad, ry2 + E.outlinePad, C.ink);
      r.ellipse(ex, cy2, rx2, ry2, (x, y) => {
        const t = (y - cy2) / ry2;
        return t < I.irisBreak ? lerpC(C.irisD, C.irisM, smooth(I.fadeTop, I.irisBreak, t)) : lerpC(C.irisM, C.irisL, smooth(I.irisBreak, I.fadeBottom, t));
      });
      const P = E.pupil;
      const pk = smooth(P.fade[0], P.fade[1], open);
      r.ellipse(ex, cy2 + ry2 * P.dy, rx2 * P.rx * pk, ry2 * P.ry * pk, C.pupil);
      // ハイライトも、ひらきに合わせて少しずつ現れる
      const hk = smooth(E.highlights.fade[0], E.highlights.fade[1], open);
      if (hk > 0.02) {
        for (const h of E.highlights.list) {
          r.ellipse(ex + side * h.x * (h.sizeScaled ? e.size : 1) * EYE_K + h.nudge, cy2 + ry2 * h.yRel, h.rx * hk * EYE_K, h.ry * hk * EYE_K, C.spark);
        }
      }
    }
    // 線(まぶた/にっこり弧/＞＜)。太さも連続して変わる
    const wLine = E.lid.width + E.lid.closedExtra * closed + E.lid.chevronExtra * chev;
    const pts = lid.map((p, k) => {
      if (chev <= 0) return p;
      const c = chevAt(k / N);
      return [p[0] + (c[0] - p[0]) * chev, p[1] + (c[1] - p[1]) * chev];
    });
    r.polyline(pts, C.ink, wLine);
  }

  /* ---- まゆ: ちいさく。怒り顔にならない角度だけ ---- */
  drawBrows(r, m, fx, fy) {
    const B = D.brows;
    for (const side of [-1, 1]) {
      const x0 = fx(D.head.cx + side * B.x0);
      const x1 = fx(D.head.cx + side * B.x1);
      const y = fy(B.y) + m.browY;
      const yi = y + m.browTilt * B.tiltInner;
      const yo = y + m.browTilt * B.tiltOuter;
      r.line(x0, yi, x1, yo, C.hairD, B.width);
    }
  }

  /* ---- 口: 楕円 → 上が平らな笑顔 → 四角い口 → 小さなすぼめ口、まで連続して変わる ---- */
  drawMouth(r, m, fx, fy, singing) {
    const M = D.mouth;
    const g = m.mouth;
    const mx = fx(D.head.cx);
    const w = Math.max(M.minW, g.w);
    const h = Math.max(M.minH, g.h);
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
    const ring = lerpC(C.lipD, C.lip, Math.min(1, (g.pad - M.ringBase) / M.ringRange));
    r.rows(top - g.pad, my + h / 2 + g.pad, shape(g.pad), ring);
    r.rows(top, my + h / 2, shape(0), C.mouthIn);
    // すぼめた唇の縦じわ(放射状の線)と、ぷるんとしたつや
    if (g.wrinkle > 0.05) {
      const Wr = M.wrinkle;
      for (let i = 0; i < Wr.count; i++) {
        const a = ((i + 0.5) / Wr.count) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const r0 = Wr.inner * g.pad + 0.0, r1 = Wr.outer * g.pad;
        const ex0 = half + r0, ey0 = h / 2 + r0, ex1 = half + r1 * g.wrinkle, ey1 = h / 2 + r1 * g.wrinkle;
        r.line(mx + ca * ex0, my + sa * ey0, mx + ca * ex1, my + sa * ey1, C.lipD, Wr.width);
      }
    }
    if (g.shine > 0.05) {
      const Sn = M.shine;
      r.ellipse(mx + half * Sn.dx * 2, top - g.pad * 0.5 + Sn.dy, Sn.r * g.shine, Sn.r * 0.7 * g.shine, C.lipHi);
    }
    // 舌: 口の大きさに応じて、小さい口ではしぼむ
    const tf = M.tongueFade;
    const tk = smooth(tf[0], tf[1], h) * smooth(tf[0], tf[1], w);
    if (tk > 0.02) {
      r.ellipse(mx, my + h * g.tg.dy, half * g.tg.rx * tk, h * g.tg.ry * tk, C.tongue);
    }
    if (singing) r.ellipse(mx + half + M.singingSpark.dx, my + M.singingSpark.dy, M.singingSpark.r, M.singingSpark.r, C.spark);
  }

  /* ---- 前髪: ぱっつんにまるい毛先 ---- */
  drawFringe(r, cx, cy) {
    const F = D.hair.fringe;
    const hw = this.neutralHW;
    const topY = cy + F.top;
    const R = F.R;
    const base = cy + F.base;
    const tip = (x) => {
      const d = Math.abs(x - cx);
      const wave = Math.abs(Math.sin(((x - cx) * Math.PI) / F.wave.period));
      const part = d < F.part.half ? F.part.depth + d * F.part.slope : 0; // 真ん中のわけ目
      const sweep = Math.min(1, d / F.sweep.radius);
      return base + F.wave.amp * wave * (1 - sweep * F.wave.sweepDamp) - sweep * sweep * F.sweep.drop + part;
    };
    const x0 = Math.floor((cx - R) * S);
    const x1 = Math.ceil((cx + R) * S);
    const tips = [];
    for (let X = x0; X <= x1; X++) tips[X - x0] = tip((X + 0.5) / S);
    for (let Y = Math.floor(topY * S); Y <= Math.ceil((cy + F.bottom) * S); Y++) {
      const yc = (Y + 0.5) / S;
      const w = hw(yc);
      for (let X = x0; X <= x1; X++) {
        const xc = (X + 0.5) / S;
        const u = (xc - cx) / R;
        if (Math.abs(u) > 1) continue;
        if (yc < cy + D.hair.back.dy - F.domeRy * Math.sqrt(1 - u * u)) continue;
        const tp = tips[X - x0];
        const inFringe = yc < tp;
        // サイドの髪(顔の縁にそって下りる)
        const dx = Math.abs(xc - cx);
        const side = w > 0 && dx > w - F.side.in && dx < w + F.side.out && yc < cy + F.side.yMax;
        if (!inFringe && !side) continue;
        // 毛先の少し内側を濃くして、毛束の厚みを出す
        const edge = inFringe && yc > tp - F.edge;
        r.put(X, Y, edge ? C.hairD : C.hair);
      }
    }
    // 毛束の筋(うすい影)
    const St = F.strands;
    for (const dx of St.dx) {
      const x = cx + dx;
      r.line(x, topY + St.top, x + Math.sign(dx) * St.lean, tip(x) - St.bottomUp, C.hairD, St.width);
    }
    // てっぺんのつや(天使の輪)
    const Rg = F.ring;
    const ring = [];
    for (let k = -10; k <= 10; k++) {
      const u = k / 10;
      const x = cx + u * Rg.halfWidth;
      const y = cy + D.hair.back.dy - F.domeRy * Math.sqrt(1 - Math.pow((x - cx) / R, 2)) + Rg.dy + u * u * Rg.curve;
      ring.push([x, y]);
    }
    r.polyline(ring, C.hairL, Rg.width);
    r.polyline(ring.slice(Rg.hiFrom, Rg.hiTo), C.hairLL, Rg.hiWidth);
  }

  /* ---- 手: う(横からおさえる)のとき、両手でほっぺを押さえる。重みに応じて近づく ---- */
  drawHands(r, m, cx, fy) {
    const Hh = D.fx.hands;
    const wu = m.w.u;
    const k = smooth(Hh.ramp[0], Hh.ramp[1], wu);
    if (k < 0.04) return;
    const hy = fy(Hh.y);
    const ow = Hh.outline;
    for (const side of [-1, 1]) {
      const edge = this.headHW(hy);
      // 頬の縁に食い込む位置。弱いうちは外側から近づいてくる
      const hx = cx + side * ((edge < 0 ? 20 : edge) + Hh.inset + (1 - k) * Hh.slide);
      const ang = (side * Hh.tilt * Math.PI) / 180;
      const ux = Math.sin(ang), uy = -Math.cos(ang); // 指の向き(上。外側へ少し傾ける)
      const px = -uy, py = ux;
      const pl = Hh.palm.len, pw = Hh.palm.w;
      const c = [hx, hy];
      const top = [c[0] + ux * pl / 2, c[1] + uy * pl / 2];
      const bot = [c[0] - ux * pl / 2, c[1] - uy * pl / 2];
      const F = Hh.finger;
      const parts = []; // [x0,y0,x1,y1,width]
      parts.push([bot[0], bot[1], top[0], top[1], pw]); // てのひら
      for (let j = 0; j < F.n; j++) {
        const o = (j - (F.n - 1) / 2) * F.spacing;
        const bx = top[0] + px * o, by = top[1] + py * o;
        const dx = ux + px * o * F.fan * 0.5, dy = uy + py * o * F.fan * 0.5;
        const dl = Math.hypot(dx, dy);
        const len = F.len * (1 - 0.12 * Math.abs(j - (F.n - 1) / 2));
        parts.push([bx, by, bx + (dx / dl) * len, by + (dy / dl) * len, F.w]);
      }
      const T = Hh.thumb;
      const tb = [c[0] - side * (pw * 0.35), c[1] + T.dy];
      parts.push([tb[0], tb[1], tb[0] - side * T.dxIn * T.len, tb[1] + T.len * 0.55, T.w]);
      const A = Hh.arm;
      const arm = [bot[0], bot[1], cx + side * A.toX, A.toY, A.w];
      // 外側の線 → 肌の順に塗って、まるい輪郭にする
      r.line(arm[0], arm[1], arm[2], arm[3], C.handLine, arm[4] + ow * 2);
      for (const q of parts) r.line(q[0], q[1], q[2], q[3], C.handLine, q[4] + ow * 2);
      r.line(arm[0], arm[1], arm[2], arm[3], C.skin, arm[4]);
      for (const q of parts) r.line(q[0], q[1], q[2], q[3], C.skin, q[4]);
      // てのひらの影(頬に当たる側)と、爪のような小さなハイライト
      // てのひらの影(頬に当たる側)
      r.line(c[0] - side * pw * 0.22, c[1] - pl * 0.1, c[0] - side * pw * 0.22, c[1] + pl * 0.4, C.handShade, 1.6);
      // 腕のつけ根の影
      r.line(bot[0], bot[1] + 0.6, bot[0] + side * 4, bot[1] + 7, C.handShade, 1.4);
    }
  }

  /* ---- 効果(マンガ記号): 母音の重みに応じて大きさが連続して変わる ---- */
  drawFx(r, m, fx, fy) {
    const X = D.fx;
    const col = C.spark;
    const cx0 = D.head.cx;
    const ramp = (k) => smooth(X.ramp[0], X.ramp[1], m.w[k]);
    const wi = ramp("i");
    if (wi > 0.04) {
      const Sp = X.sparkle;
      const sp = (x, y) => {
        const k = Sp.size * wi;
        r.line(x - k, y, x + k, y, col, Sp.width);
        r.line(x, y - k, x, y + k, col, Sp.width);
        r.ellipse(x, y, Sp.dot * wi, Sp.dot * wi, col);
      };
      for (const p of Sp.pos) sp(fx(cx0 + p[0]), fy(p[1]));
    }
    const wu = ramp("u");
    if (wu > 0.04) {
      const Q = X.squeeze;
      for (const side of [-1, 1]) {
        const x = fx(cx0 + side * Q.x) + side * Q.push;
        const k = wu;
        r.polyline([[x, fy(Q.y - Q.len * k)], [x - side * Q.back * k, fy(Q.y)], [x, fy(Q.y + Q.len * k)]], col, Q.width);
      }
    }
    const we = ramp("e");
    if (we > 0.04) {
      const W = X.sweat;
      const x = fx(cx0 + W.x);
      r.ellipse(x, fy(W.y), W.rx * we, W.ry * we, C.sweat);
      r.poly([[x, fy(W.y - W.tipLen * we)], [x - W.tipHalf * we, fy(W.tipY)], [x + W.tipHalf * we, fy(W.tipY)]], C.sweat);
    }
    const wo = ramp("o");
    if (wo > 0.04) {
      const Sh = X.shout;
      for (const side of [-1, 1]) {
        const x = cx0 + side * Sh.x;
        r.line(x, fy(Sh.y1), x + side * Sh.len1 * wo, fy(Sh.y1 - Sh.len1 * wo), col, Sh.width);
        r.line(x + side, fy(Sh.y2), x + side * (1 + Sh.len2 * wo), fy(Sh.y2), col, Sh.width);
      }
    }
  }
}

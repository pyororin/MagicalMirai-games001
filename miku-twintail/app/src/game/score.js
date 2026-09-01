/* =============================================================================
 * ミク度（この企画の根幹）
 *
 * 「ミクっぽさ」を、測れる 5 つの指標の合計 0〜100 点で厳密に定義する。
 * リズム（40）と造形（60）。造形は「髪型のお題どおりか」を最重視する。
 *
 *  R  リズム       40 = 房ごと 20（PERFECT 20 / GOOD 12 / OK 5 / ネギ 0）
 *  A  角度         20 = 房ごと 10。お題の髪型が指定する目標角との差 err[rad]
 *                       10 × clamp01(1 − err / 0.35)   （0.35rad ≒ 20°でゼロ）
 *  P  つけ位置     15 = 房ごと 7.5。正しい側 5 ＋ 根元の高さ 2.5
 *                       左右を取り違えるとその房の 5 点は 0（＝最大 −10 点）
 *  S  左右の対称   15 = 鏡映角の一致 8 ＋ 長さの一致 7（両房が髪のときのみ）
 *  L  長さ         10 = 平均房長 ÷ 目標長 が 1.0 で満点（両房が髪のときのみ）
 *
 * さらに減点:
 *  X  左右取り違え  −12 / 房。ツインテールとして成立していないため、
 *                    その房の側点 5 を失うことに加えて重く引く。
 *                    1 本でも取り違えた時点で S（左右の対称）も 0 になる。
 *
 * ネギ（失敗）の房は R/A/P すべて 0 になり、S・L も成立しない。
 * ＝片方でもネギならミク度は最大 47.5。両方取り違えると最大 51。
 * 合計は 0〜100 にクランプする。
 * ========================================================================== */

export const clamp01 = v => Math.max(0, Math.min(1, v));
export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* お題の髪型。ang = 右房の目標角（0=真横, π/2=真下）。len = 目標長 ÷ お題の高さ */
export const STYLES = [
  { key: "straight", name: "ストレート",     ang: 1.40, len: 0.85 },
  { key: "ha",       name: "ハの字",         ang: 1.05, len: 0.78 },
  { key: "long",     name: "ロング",         ang: 1.45, len: 1.05 },
  { key: "soto",     name: "外ハネ",         ang: 0.88, len: 0.72 },
  { key: "short",    name: "ショート",       ang: 1.30, len: 0.48 },
  { key: "fuwa",     name: "ふんわりロング", ang: 1.15, len: 0.95 },
];
/** 左房は垂直軸で鏡映した角が目標になる */
export const targetAngle = (side, style) => (side === "L" ? Math.PI - style.ang : style.ang);
/** お題の「大きさ」。平たい物でも髪が寸詰まりにならないよう幅も見る */
export const objSize = o => Math.max(o.h, o.w * 0.62);
/** 目標の房長（ワールド座標）。ミク度の長さ点も操作ガイドもこの値を使う */
export const targetLen = (style, obj, scale) => style.len * objSize(obj) * scale;

export const RHYTHM_PT = { PERFECT: 20, GOOD: 12, OK: 5, MISS: 0 };
const ANG_TOL = 0.35;          // これだけずれると角度点が 0（髪型の差が出る幅に合わせた）
export const WRONG_SIDE_PT = 12;   // 左右取り違え 1 房あたりの減点

/** 房 1 本の造形点。unit を持たずに検証できるよう分離してある */
export function tailScore(tail, side, style, obj) {
  const out = { rhythm: 0, ang: 0, side: 0, height: 0, wrongSide: false };
  if (!tail) return out;
  out.rhythm = RHYTHM_PT[tail.grade] || 0;
  if (tail.kind !== "hair") { out.rhythm = 0; return out; }
  // 角度: お題の髪型どおりか
  const err = Math.abs(normAngle(tail.angle - targetAngle(side, style)));
  out.ang = 10 * clamp01(1 - err / ANG_TOL);
  out.angErr = err;
  // つけ位置: 正しい側か（外向きを正とする）＋ 根元が上のほうか
  const dir = side === "L" ? -1 : 1, hw = obj.w / 2, hh = obj.h / 2;
  const outward = (tail.rx * dir) / hw;
  out.wrongSide = outward < 0;
  out.side = 5 * clamp01((outward + 0.02) / 0.30);
  const hy = -tail.ry / hh;                      // 1 = 上端, 0 = 中央
  out.height = 2.5 * clamp01(1 - Math.abs(hy - 0.88) / 0.7);
  return out;
}

/** 完成した 1 体のミク度。返り値の内訳はスコア表示・記録にそのまま使う */
export function mikuScore(u, scale = 1) {
  const style = u.style, obj = u.obj;
  const L = u.tails.L, R = u.tails.R;
  const sL = tailScore(L, "L", style, obj), sR = tailScore(R, "R", style, obj);
  const rhythm = sL.rhythm + sR.rhythm;
  const ang = sL.ang + sR.ang;
  const place = sL.side + sL.height + sR.side + sR.height;
  const wrong = (sL.wrongSide ? 1 : 0) + (sR.wrongSide ? 1 : 0);
  const bothHair = L && R && L.kind === "hair" && R.kind === "hair";
  let sym = 0, len = 0;
  if (bothHair && wrong === 0) {
    const dTheta = Math.abs(normAngle((Math.PI - L.angle) - R.angle));
    sym = 8 * clamp01(1 - dTheta / 0.55)
        + 7 * clamp01(1 - Math.abs(L.len - R.len) / Math.max(L.len, R.len, 1) / 0.45);
    const want = targetLen(style, obj, scale);
    len = 10 * clamp01(1 - Math.abs((L.len + R.len) / 2 / want - 1) / 0.55);
  } else if (bothHair) {                       // 取り違えていても長さの努力だけは見る
    const want = targetLen(style, obj, scale);
    len = 10 * clamp01(1 - Math.abs((L.len + R.len) / 2 / want - 1) / 0.55);
  }
  const penalty = WRONG_SIDE_PT * wrong;
  const total = Math.max(0, Math.min(100, Math.round(rhythm + ang + place + sym + len - penalty)));
  return { total, rhythm: +rhythm.toFixed(1), ang: +ang.toFixed(1), place: +place.toFixed(1),
           sym: +sym.toFixed(1), len: +len.toFixed(1), penalty,
           wrongSide: wrong,
           angErrDeg: [sL.angErr, sR.angErr].map(e => e === undefined ? null : Math.round(e * 180 / Math.PI)) };
}

/** ミク度 → 掛け声・称号・背景での光り方 */
export function rankOf(m, objName) {
  if (m >= 93) return { text: "ミクーッ！", label: "本人",           glow: 1.0 };
  if (m >= 80) return { text: "ミク！",     label: "ほぼミク",       glow: 0.6 };
  if (m >= 64) return { text: "ミク。",     label: "ミク見習い",     glow: 0.25 };
  if (m >= 42) return { text: "ミク？",     label: "言い張ればミク", glow: 0 };
  return { text: "だれ？", label: "ただの" + objName, glow: 0 };
}

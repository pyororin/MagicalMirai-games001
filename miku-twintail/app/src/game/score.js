/* =============================================================================
 * ミク度（この企画の根幹）— v3
 *
 * 「ミクっぽさ」を、測れる 6 つの指標の合計 0〜100 点で厳密に定義する。
 * リズム（36）と造形（64）。造形は「お題の髪型どおりか」と
 * 「そもそもツインテールの形になっているか」を柱にする。
 *
 *  R  リズム         36 = 房ごと 18（PERFECT 18 / GOOD 11 / OK 4 / ネギ 0）
 *  A  角度           18 = 房ごと 9。お題の髪型が指定する目標角との差 err[rad]
 *                        9 × clamp01(1 − err / 0.35)   （0.35rad ≒ 20°でゼロ）
 *  T  ツインテールらしさ 16 = 房ごと 8。房の**形そのもの**を見る
 *                        素直さ 4 × clamp01((reach − 0.55) / 0.20)
 *                          reach = 毛先までの直線距離 ÷ 弧長。
 *                          巻き込み・折り返し・往復はここで落ちる
 *                        垂れ   4 × clamp01((descent − 0.45) / 0.40)
 *                          descent = 下へ向かっている区間の割合。
 *                          上へ跳ね上げた房はここで落ちる
 *  P  つけ位置       12 = 房ごと 6。正しい側 4 ＋ 根元の高さ 2
 *  S  左右の対称     10 = 鏡映角の一致 5 ＋ 長さの一致 5（両房が髪のときのみ）
 *  L  長さ            8 = 平均房長 ÷ 目標長 が 1.0 で満点（両房が髪のときのみ）
 *
 * さらに減点:
 *  X  左右取り違え  −12 / 房。ツインテールとして成立していないため、
 *                    その房の側点 4 を失うことに加えて重く引く。
 *                    1 本でも取り違えた時点で S（左右の対称）も 0 になる。
 *
 * ネギ（失敗）の房は R/A/T/P すべて 0 になり、S・L も成立しない。
 * ＝片方でもネギならミク度は最大 45。両方取り違えると最大 52。
 * 合計は 0〜100 にクランプする。
 *
 * 難易度を変えても**この定義は動かない**（§DIFFICULTY 参照）。
 * ========================================================================== */

export const clamp01 = v => Math.max(0, Math.min(1, v));
export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* お題の髪型。ang = 右房の目標角（0=真横, π/2=真下）。len = 目標長 ÷ お題の大きさ */
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

export const RHYTHM_PT = { PERFECT: 18, GOOD: 11, OK: 4, MISS: 0 };

/* 難易度。**ミク度の定義そのものは変えない**（角度の許容 0.35rad は全難易度で共通）。
 * 変わるのは「拍の判定窓」「お題の髪型ガイドの出し方」「サビのキメ」だけ。
 * こうしておくと、難易度をまたいでもミク度は同じ物差しのままになる。
 *   window  … これを超えるとネギ（拍単位）
 *   perfect / good … 判定帯（拍単位）
 *   guide   … always(常時) / approach(近づいてくる間) / slide(伸ばしている間だけ)
 *   kime    … サビの決めポーズを出すか */
export const DIFFICULTY = {
  easy:   { key: "easy",   name: "やさしい",   window: 1.00, perfect: 0.16, good: 0.36, guide: "always",   kime: false },
  normal: { key: "normal", name: "ふつう",     window: 0.72, perfect: 0.11, good: 0.26, guide: "approach", kime: true  },
  hard:   { key: "hard",   name: "むずかしい", window: 0.45, perfect: 0.07, good: 0.17, guide: "slide",    kime: true  },
};
export const gradeOf = (d, diff) => { const a = Math.abs(d);
  return a <= diff.perfect ? "PERFECT" : a <= diff.good ? "GOOD" : a <= diff.window ? "OK" : "MISS"; };

/** サビでは髪型をロング寄りに寄せる。同じ 2 拍でより長く伸ばす必要があり、
 *  操作の構造を変えずに「サビだけ手が忙しくなる」感覚を作れる */
export const CHORUS_STYLES = ["long", "fuwa", "straight"];
const ANG_TOL = 0.35;          // これだけずれると角度点が 0（髪型の差が出る幅に合わせた）
export const WRONG_SIDE_PT = 12;   // 左右取り違え 1 房あたりの減点

/** 房 1 本の点。unit を持たずに検証できるよう分離してある。
 *  tail は pathMetrics 済みの angle / len / reach / descent を持つ */
export function tailScore(tail, side, style, obj) {
  const out = { rhythm: 0, ang: 0, twin: 0, side: 0, height: 0, wrongSide: false };
  if (!tail) return out;
  out.rhythm = RHYTHM_PT[tail.grade] || 0;
  if (tail.kind !== "hair") { out.rhythm = 0; return out; }
  // 角度: お題の髪型どおりか
  const err = Math.abs(normAngle(tail.angle - targetAngle(side, style)));
  out.ang = 9 * clamp01(1 - err / ANG_TOL);
  out.angErr = err;
  // ツインテールらしさ: 素直に伸びているか＋垂れているか
  out.twin = 4 * clamp01(((tail.reach || 0) - 0.55) / 0.20)
           + 4 * clamp01(((tail.descent || 0) - 0.45) / 0.40);
  // つけ位置: 正しい側か（外向きを正とする）＋ 根元が上のほうか
  const dir = side === "L" ? -1 : 1, hw = obj.w / 2, hh = obj.h / 2;
  const outward = (tail.rx * dir) / hw;
  out.wrongSide = outward < 0;
  out.side = 4 * clamp01((outward + 0.02) / 0.30);
  const hy = -tail.ry / hh;                      // 1 = 上端, 0 = 中央
  out.height = 2 * clamp01(1 - Math.abs(hy - 0.88) / 0.7);
  return out;
}

/** 完成した 1 体のミク度。返り値の内訳はスコア表示・記録にそのまま使う */
export function mikuScore(u, scale = 1) {
  const style = u.style, obj = u.obj;
  const L = u.tails.L, R = u.tails.R;
  const sL = tailScore(L, "L", style, obj), sR = tailScore(R, "R", style, obj);
  const rhythm = sL.rhythm + sR.rhythm;
  const ang = sL.ang + sR.ang;
  const twin = sL.twin + sR.twin;
  const place = sL.side + sL.height + sR.side + sR.height;
  const wrong = (sL.wrongSide ? 1 : 0) + (sR.wrongSide ? 1 : 0);
  const bothHair = L && R && L.kind === "hair" && R.kind === "hair";
  let sym = 0, len = 0;
  if (bothHair && wrong === 0) {
    const dTheta = Math.abs(normAngle((Math.PI - L.angle) - R.angle));
    sym = 5 * clamp01(1 - dTheta / 0.55)
        + 5 * clamp01(1 - Math.abs(L.len - R.len) / Math.max(L.len, R.len, 1) / 0.45);
    const want = targetLen(style, obj, scale);
    len = 8 * clamp01(1 - Math.abs((L.len + R.len) / 2 / want - 1) / 0.55);
  } else if (bothHair) {                       // 取り違えていても長さの努力だけは見る
    const want = targetLen(style, obj, scale);
    len = 8 * clamp01(1 - Math.abs((L.len + R.len) / 2 / want - 1) / 0.55);
  }
  const penalty = WRONG_SIDE_PT * wrong;
  const total = Math.max(0, Math.min(100,
    Math.round(rhythm + ang + twin + place + sym + len - penalty)));
  return { total, rhythm: +rhythm.toFixed(1), ang: +ang.toFixed(1), twin: +twin.toFixed(1),
           place: +place.toFixed(1), sym: +sym.toFixed(1), len: +len.toFixed(1), penalty,
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

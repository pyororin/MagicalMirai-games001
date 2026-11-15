// 顔の表情の重みを、目標へバネで追従させる(純関数)。
// 指の動きに対して、ぷるんと少し行き過ぎてから戻る「ゴムっぽさ」を出す。
//   hz      … バネの速さ(固有振動数)
//   damping … 減衰比。1 未満で行き過ぎる(小さいほどよく揺れる)。1 以上は行き過ぎない
// 半陰的オイラーで細かく刻むので、フレーム間隔が長くても発散しない。
export const SPRING_LIMITS = { min: -0.3, max: 1.35 }; // 行き過ぎの上限(ひどい崩れを防ぐ)

/**
 * @param {Record<string,number>} w   現在の重み(破壊的に更新)
 * @param {Record<string,number>} vel 速度(破壊的に更新)
 * @param {Record<string,number>} tgt 目標の重み
 * @param {number} dt 秒
 * @param {string[]} keys 対象のキー
 */
export function stepSpring(w, vel, tgt, dt, hz, damping, keys) {
  const w0 = 2 * Math.PI * hz;
  const steps = Math.max(1, Math.ceil(dt / 0.006));
  const h = dt / steps;
  for (let n = 0; n < steps; n++) {
    for (const k of keys) {
      const acc = w0 * w0 * (tgt[k] - w[k]) - 2 * damping * w0 * vel[k];
      vel[k] += acc * h;
      w[k] += vel[k] * h;
    }
  }
  for (const k of keys) w[k] = Math.max(SPRING_LIMITS.min, Math.min(SPRING_LIMITS.max, w[k]));
}

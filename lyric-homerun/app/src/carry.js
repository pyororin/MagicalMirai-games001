// 打球の飛距離と落下位置(純関数)。結果ウィンドウ(「どこまで届いたか」)の元データ。
// 座標: ホームが原点。+y が センター方向、+x が ライト方向(メートル)。
// 方向は judge.direction と同じ向き(早い=左=引っ張り、遅い=右=流し)。
// ホームラン判定は judge.js が決める(タイミングだけ)。ここではそれと必ず食い違わないように距離を決める:
//   特大・ホームラン … フェンス(fence)より遠く / ヒット … フェンスの手前。
import { direction } from "./judge.js";

export const FOUL_DEG = 42; // 打球の最大角(ファウルラインの手前)
export const FENCE_LINE = 98; // フェンスまでの距離: ライン際(m)
export const FENCE_CENTER = 120; // 同: センター(m)

/** その角度(度)でのフェンスまでの距離(m)。ライン際が近く、センターが遠い。 */
export function fence(angleDeg) {
  const k = Math.min(1, Math.abs(angleDeg) / 45);
  return FENCE_LINE + (FENCE_CENTER - FENCE_LINE) * (1 - k * k);
}

const hash01 = (n) => {
  const x = Math.sin((n + 1) * 91.7) * 24634.6345;
  return x - Math.floor(x);
};

export function zoneOf(angleDeg) {
  return angleDeg < -14 ? "レフト" : angleDeg > 14 ? "ライト" : "センター";
}

/**
 * @param {"big"|"hr"|"hit"|"whiff"|"look"} res
 * @param {number} dt ずれ(ms)。負は早い
 * @param {number} idx 球の番号(同じ記録なら同じ絵になる揺らぎ用)
 * @returns {null | {dist:number, angle:number, x:number, y:number, fence:number, homerun:boolean, zone:string, place:string}}
 */
export function carry(res, dt, idx = 0) {
  if (res !== "big" && res !== "hr" && res !== "hit") return null;
  const angle = direction(dt) * FOUL_DEG;
  const f = fence(angle);
  const a = Math.abs(dt);
  let dist;
  if (res === "big") dist = f + 8 + (Math.max(0, 45 - a) / 45) * 35;
  else if (res === "hr") dist = f + 1 + (Math.max(0, 90 - a) / 45) * 7;
  else dist = f * 0.25 + (Math.max(0, 150 - a) / 60) * f * 0.5;
  // 小さな揺らぎ(±1.5%)。クラスの境目は越えない
  dist *= 1 + (hash01(idx) - 0.5) * 0.03;
  if (res === "hit") dist = Math.min(dist, f - 1);
  else dist = Math.max(dist, f + 0.5);
  dist = Math.round(dist * 10) / 10; // 座標も、この丸めた距離から出す
  const rad = (angle * Math.PI) / 180;
  const zone = zoneOf(angle);
  let place;
  if (res === "big") place = `${zone}・スタンド最上段`;
  else if (res === "hr") place = `${zone}・スタンドイン`;
  else place = dist < f * 0.4 ? "内野" : `${zone}・手前に落ちた`;
  return {
    dist,
    angle,
    x: Math.sin(rad) * dist,
    y: Math.cos(rad) * dist,
    fence: f,
    homerun: res !== "hit",
    zone,
    place,
  };
}

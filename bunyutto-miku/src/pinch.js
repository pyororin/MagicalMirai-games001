// ピンチ検出(純関数)。顔の上にある2本の指から「どの母音の顔か」と「どれだけ変形させたか」を出す。
//
// ピンチは相対的な動き。2本目の指を置いた距離を基準(ratio=1)にして、
//   開く(ratio>1) = out   つぼめる(ratio<1) = in
// 指の結ぶ線が横寄りなら h、縦寄りなら v。
//   h+out=い  h+in=う  v+in=え  v+out=お  それ以外=あ
import { vowelOfGesture } from "./vowel.js?v=10";

export const PINCH = {
  dead: 0.07, // 基準の±7%は「動かしていない」とみなす
  outFull: 1.9, // ratio がここで amount=1(広めにとり、指の動きの全域で連続的に変わるように)
  inFull: 0.42,
  toV: 56, // 横→縦に切り替わる角度(度)。ヒステリシスでちらつきを防ぐ
  toH: 34,
  minBase: 28, // 基準距離の下限(px)。指が近すぎる置き方でも暴れない
};

export class PinchTracker {
  constructor() {
    this.pts = new Map();
    this.base = 0;
    this.axis = null;
    this.state = { vowel: "a", amount: 0, axis: null, dir: null, ratio: 1 };
  }

  reset() {
    this.pts.clear();
    this.base = 0;
    this.axis = null;
    this._update();
  }

  down(id, x, y) {
    this.pts.set(id, { x, y });
    if (this.pts.size === 2) this._calibrate();
    this._update();
  }

  move(id, x, y) {
    const p = this.pts.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    this._update();
  }

  up(id) {
    this.pts.delete(id);
    // 3本以上から減った場合は残りの先頭2本で基準を取り直す
    if (this.pts.size === 2) this._calibrate();
    else this.base = 0;
    this._update();
  }

  get count() {
    return this.pts.size;
  }

  _pair() {
    const it = [...this.pts.values()];
    return it.length >= 2 ? [it[0], it[1]] : null;
  }

  _calibrate() {
    const pr = this._pair();
    if (!pr) return;
    this.base = Math.max(PINCH.minBase, Math.hypot(pr[1].x - pr[0].x, pr[1].y - pr[0].y));
    const ang = this._angle(pr);
    this.axis = ang < 45 ? "h" : "v";
  }

  _angle(pr) {
    return (Math.atan2(Math.abs(pr[1].y - pr[0].y), Math.abs(pr[1].x - pr[0].x)) * 180) / Math.PI;
  }

  _update() {
    const pr = this._pair();
    if (!pr || !this.base) {
      this.state = { vowel: "a", amount: 0, axis: null, dir: null, ratio: 1 };
      return;
    }
    const ang = this._angle(pr);
    if (this.axis === "h" && ang > PINCH.toV) this.axis = "v";
    else if (this.axis === "v" && ang < PINCH.toH) this.axis = "h";
    const dist = Math.hypot(pr[1].x - pr[0].x, pr[1].y - pr[0].y);
    this.state = classify(this.axis, dist / this.base);
  }
}

/** 軸と距離比から状態を出す。テストしやすいよう単独でも使える。 */
export function classify(axis, ratio) {
  const { dead, outFull, inFull } = PINCH;
  let dir = null;
  let amount = 0;
  if (ratio > 1 + dead) {
    dir = "out";
    amount = Math.min(1, (ratio - 1 - dead) / (outFull - 1 - dead));
  } else if (ratio < 1 - dead) {
    dir = "in";
    amount = Math.min(1, (1 - dead - ratio) / (1 - dead - inFull));
  }
  return { vowel: vowelOfGesture(axis, dir), amount: dir ? amount : 0, axis, dir, ratio };
}

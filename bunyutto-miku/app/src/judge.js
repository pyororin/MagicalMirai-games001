// 判定(純関数的な状態機械)。時刻・段・母音を受け取り、ノーツごとの結果を決める。
//
// 1ノーツ = 「タイミング」「音の高さ(段)」「顔(母音)」の3つ。
//   段が違う   … 当てた扱いにならない(取り直せる。締め切りまでに合えば当たる)
//   顔が違う   … 当たるが GOOD 止まりで点が半分(かお違い)
//   タイミング … ±70 PERFECT / ±130 GREAT / ±200 GOOD
// 取りこぼしは late(230ms)で確定する。長くすると失敗音が遅れる
// (ontology/rhythm-game.yaml の miss-declared-too-late)。

export const WIN = { perfect: 70, great: 130, good: 200, late: 230 };
export const VOWEL_GRACE = { before: 160, after: 150 }; // 打鍵の前後、顔がそろえば良しとする猶予
export const POINTS = { PERFECT: 1000, GREAT: 700, GOOD: 400 };
export const HOLD_BONUS = 500;

export function comboMult(c) {
  return 1 + Math.min(c, 40) / 80; // 最大 1.5 倍
}

export function rankOf(ratio) {
  return ratio >= 0.92 ? "S" : ratio >= 0.8 ? "A" : ratio >= 0.6 ? "B" : ratio >= 0.4 ? "C" : "D";
}

export class Judge {
  /** @param {{t:number,dur:number,hold:boolean,row:number,vowel:string}[]} notes */
  constructor(notes) {
    this.notes = notes.map((n, i) => ({ ...n, i, res: null, pending: null, heldMs: 0, wrong: 0 }));
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0, FACE: 0 };
    this.vhist = []; // [時刻, 母音] の変化履歴
    this.cursor = 0; // これ未満は確定済み
    this.lastTick = null;
    this.events = []; // UI が拾う: {kind,note,grade,time,...}
  }

  /** 母音が変わった瞬間を記録する */
  setVowel(time, vowel) {
    const h = this.vhist;
    if (!h.length || h[h.length - 1][1] !== vowel) h.push([time, vowel]);
    if (h.length > 64) h.splice(0, h.length - 32);
  }

  /** time 時点の母音 */
  vowelAt(time) {
    const h = this.vhist;
    let v = "a";
    for (let i = 0; i < h.length && h[i][0] <= time; i++) v = h[i][1];
    return v;
  }

  /** [t0,t1] のあいだに母音 v だった瞬間があるか */
  vowelWas(v, t0, t1) {
    if (this.vowelAt(t0) === v) return true;
    for (const [ht, hv] of this.vhist) if (ht > t0 && ht <= t1 && hv === v) return true;
    return false;
  }

  _window(n) {
    // 隣のノーツと食い合わないよう、中間点でクランプする
    const prev = this.notes[n.i - 1];
    const next = this.notes[n.i + 1];
    const lim = Math.min(prev ? (n.t - prev.t) / 2 : Infinity, next ? (next.t - n.t) / 2 : Infinity);
    return Math.min(WIN.good, Math.max(lim, 60));
  }

  _gradeOf(dt) {
    const a = Math.abs(dt);
    return a <= WIN.perfect ? "PERFECT" : a <= WIN.great ? "GREAT" : "GOOD";
  }

  /**
   * 指が段に触れた(押した/別の段へ滑り込んだ)。
   * @returns {{kind:'hit'|'wrong'|'free', note?:object}}
   */
  attack(time, row, opts = {}) {
    let bestMatch = null;
    let bestAny = null;
    for (let k = this.cursor; k < this.notes.length; k++) {
      const n = this.notes[k];
      if (n.t - time > WIN.good + 40) break;
      if (n.res || n.pending) continue;
      const w = this._window(n);
      const dt = time - n.t;
      if (dt < -w || dt > Math.min(w, WIN.late)) continue;
      if (!bestAny || Math.abs(dt) < Math.abs(time - bestAny.t)) bestAny = n;
      if (n.row === row && (!bestMatch || Math.abs(dt) < Math.abs(time - bestMatch.t))) bestMatch = n;
    }
    if (bestMatch) {
      const n = bestMatch;
      n.pending = { time, dt: time - n.t, deadline: time + VOWEL_GRACE.after, row };
      n.pendingFrom = opts.slide ? "slide" : "tap";
      // 打鍵の前後で顔がそろっていれば、その場で確定
      if (this.vowelWas(n.vowel, time - VOWEL_GRACE.before, time)) this._resolve(n, true, time);
      return { kind: "hit", note: n };
    }
    if (bestAny && !opts.slide) {
      bestAny.wrong++;
      this.events.push({ kind: "wrong", note: bestAny, time });
      return { kind: "wrong", note: bestAny };
    }
    return { kind: "free" };
  }

  _resolve(n, vowelOK, time) {
    const p = n.pending;
    n.pending = null;
    let grade = this._gradeOf(p.dt);
    let pts = POINTS[grade];
    if (!vowelOK) {
      grade = "GOOD";
      pts = Math.round(POINTS.GOOD * 0.5);
      this.counts.FACE++;
    }
    n.res = { grade, vowelOK, dt: p.dt };
    n.pending = null;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(pts * comboMult(this.combo));
    this.counts[grade]++;
    this.events.push({ kind: "hit", note: n, grade, vowelOK, dt: p.dt, time });
    if (n.hold) n.holding = true;
  }

  _miss(n, time) {
    n.res = { grade: "MISS", vowelOK: false, dt: 0 };
    n.pending = null;
    this.combo = 0;
    this.counts.MISS++;
    this.events.push({ kind: "miss", note: n, time });
  }

  /**
   * 毎フレーム。確定待ちの処理、取りこぼしの確定、長音の加点を進める。
   * @param {number} time 曲の時刻(ms)
   * @param {{down:boolean,row:number,vowel:string}} input いまの指と顔
   */
  tick(time, input) {
    const dt = this.lastTick == null ? 0 : Math.max(0, Math.min(100, time - this.lastTick));
    this.lastTick = time;
    for (let k = this.cursor; k < this.notes.length; k++) {
      const n = this.notes[k];
      if (n.t - time > 400 && !n.pending && !n.holding) break;
      if (n.pending) {
        if (this.vowelWas(n.vowel, n.pending.time - VOWEL_GRACE.before, time)) this._resolve(n, true, time);
        else if (time >= n.pending.deadline) this._resolve(n, false, time);
      } else if (!n.res && time - n.t > WIN.late) {
        this._miss(n, time);
      }
      if (n.holding) {
        const end = n.t + n.dur;
        if (input && input.down && input.row === n.row && input.vowel === n.vowel && time <= end + 40) n.heldMs += dt;
        if (time >= end) {
          n.holding = false;
          const ratio = Math.min(1, n.heldMs / Math.max(1, n.dur));
          const bonus = Math.round(HOLD_BONUS * ratio * comboMult(this.combo));
          this.score += bonus;
          n.holdRatio = ratio;
          this.events.push({ kind: "holdEnd", note: n, ratio, bonus, time });
        }
      }
    }
    while (this.cursor < this.notes.length && this.notes[this.cursor].res && !this.notes[this.cursor].holding) this.cursor++;
  }

  /** 全ノーツを PERFECT・最大コンボで取った場合の満点(ランク判定の分母) */
  get maxScore() {
    let s = 0;
    this.notes.forEach((n, i) => {
      s += Math.round(POINTS.PERFECT * comboMult(i + 1));
      if (n.hold) s += Math.round(HOLD_BONUS * comboMult(i + 1));
    });
    return s;
  }

  get done() {
    return this.notes.every((n) => n.res && !n.holding);
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

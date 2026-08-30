import { describe, it, expect } from "vitest";
import {
  grade,
  clampWindow,
  scorePhrase,
  selectNotes,
  requiredKps,
  DEFAULT_WINDOW,
  type Note,
} from "./judge";

const note = (kana: string, startTime: number): Note => ({ kana, startTime });

describe("grade — 判定区分", () => {
  const n = note("か", 1000);
  const w = DEFAULT_WINDOW;

  it("発声時刻ちょうどは JUST", () => {
    expect(grade(1000, n, w).grade).toBe("JUST");
  });

  it("±100ms 以内は JUST", () => {
    expect(grade(1090, n, w).grade).toBe("JUST");
    expect(grade(910, n, w).grade).toBe("JUST");
  });

  it("±250ms 以内は GREAT", () => {
    expect(grade(1200, n, w).grade).toBe("GREAT");
  });

  it("±450ms 以内は GOOD", () => {
    expect(grade(1400, n, w).grade).toBe("GOOD");
  });

  it("大きく遅れると LATE", () => {
    expect(grade(1800, n, w).grade).toBe("LATE");
  });

  it("フレーズ終了まで打たれなければ MISS", () => {
    expect(grade(3000, n, w).grade).toBe("MISS");
  });
});

describe("grade — 先行入力(タイプアヘッド)", () => {
  const n = note("か", 5000);

  it("発声よりずっと早い確定は MISS ではなく TYPED", () => {
    // ここが設計の要。速い箇所を打ち貯めても罰しない。
    const r = grade(3000, n, DEFAULT_WINDOW);
    expect(r.grade).toBe("TYPED");
    expect(r.delta).toBeLessThan(0);
  });

  it("TYPED は基礎点のみ、JUST の半分の価値", () => {
    const typed = scorePhrase([n], [3000]);
    const just = scorePhrase([n], [5000]);
    expect(typed.judgements[0].grade).toBe("TYPED");
    expect(just.judgements[0].grade).toBe("JUST");
    expect(typed.total).toBeLessThan(just.total);
    expect(typed.total * 2).toBe(just.total);
  });

  it("TYPED でもコンボは継続する", () => {
    const notes = [note("あ", 1000), note("い", 2000), note("う", 3000)];
    const r = scorePhrase(notes, [0, 0, 0]); // 全部先行入力
    expect(r.judgements.every((j) => j.grade === "TYPED")).toBe(true);
    expect(r.maxCombo).toBe(3);
  });
});

describe("clampWindow — 密な箇所で判定域が食い合わない", () => {
  it("ノート間隔が狭いと窓が縮む", () => {
    // 120ms 間隔 = 隣との中間は 60ms
    const notes = [note("あ", 0), note("い", 120), note("う", 240)];
    const w = clampWindow(notes, 1);
    expect(w.just).toBeLessThanOrEqual(60);
    expect(w.good).toBeLessThanOrEqual(60);
  });

  it("ノート間隔が広ければ既定値のまま", () => {
    const notes = [note("あ", 0), note("い", 2000), note("う", 4000)];
    const w = clampWindow(notes, 1);
    expect(w.just).toBe(DEFAULT_WINDOW.just);
    expect(w.good).toBe(DEFAULT_WINDOW.good);
  });

  it("隣接ノートを誤って JUST 判定しない", () => {
    const notes = [note("あ", 0), note("い", 120)];
    const w = clampWindow(notes, 0);
    // ノート1の発声時刻(120ms)でノート0を判定しても JUST にはならない
    expect(grade(120, notes[0], w).grade).not.toBe("JUST");
  });
});

describe("selectNotes — 密度制御", () => {
  /** 100ms 間隔の高密度フレーズ(早口)。等速では打ち切れない。 */
  const dense: Note[] = Array.from({ length: 40 }, (_, i) =>
    note("あ", i * 100)
  );

  it("HARD は全文字を打たせる", () => {
    expect(selectNotes(dense, "HARD")).toHaveLength(40);
  });

  it("EASY / NORMAL は打鍵対象を間引く", () => {
    const easy = selectNotes(dense, "EASY");
    const normal = selectNotes(dense, "NORMAL");
    expect(easy.length).toBeLessThan(normal.length);
    expect(normal.length).toBeLessThan(40);
  });

  it("フレーズ先頭は必ず打鍵対象に残る", () => {
    expect(selectNotes(dense, "EASY")[0]).toBe(0);
  });

  it("間引き後は人間が打てる速度に収まる", () => {
    // 全文字だと 2打鍵/文字 × 10文字/秒 = 20打鍵/秒。到底無理。
    const hardKps = requiredKps(dense, selectNotes(dense, "HARD"));
    expect(hardKps).toBeGreaterThan(15);

    // NORMAL なら 4打鍵/秒程度に収まる(速いが到達可能な水準)
    const normalKps = requiredKps(dense, selectNotes(dense, "NORMAL"));
    expect(normalKps).toBeLessThanOrEqual(4.5);

    // EASY なら 2打鍵/秒程度
    const easyKps = requiredKps(dense, selectNotes(dense, "EASY"));
    expect(easyKps).toBeLessThanOrEqual(2.5);
  });
});

describe("scorePhrase — スコアとコンボ", () => {
  const notes = [note("あ", 1000), note("い", 2000), note("う", 3000)];

  it("未入力は MISS でコンボが切れる", () => {
    const r = scorePhrase(notes, [1000, null, 3000]);
    expect(r.judgements.map((j) => j.grade)).toEqual(["JUST", "MISS", "JUST"]);
    expect(r.maxCombo).toBe(1);
  });

  it("JUST を重ねるほど高得点", () => {
    const perfect = scorePhrase(notes, [1000, 2000, 3000]);
    const sloppy = scorePhrase(notes, [1400, 2400, 3400]); // 全部 GOOD
    expect(perfect.total).toBeGreaterThan(sloppy.total);
  });

  it("曲は止まらない: 打ち切れなくてもスコアは成立する", () => {
    const r = scorePhrase(notes, [null, null, null]);
    expect(r.total).toBe(0);
    expect(r.judgements.every((j) => j.grade === "MISS")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { toSegments, PhraseTyper } from "./romaji";

/** 文字列を1打鍵ずつ流し込み、確定したセグメント数を返す。 */
function typeAll(typer: PhraseTyper, input: string) {
  let commits = 0;
  let misses = 0;
  for (const ch of input) {
    const r = typer.input(ch);
    if (r.type === "commit") commits++;
    if (r.type === "miss") misses++;
  }
  return { commits, misses };
}

describe("toSegments", () => {
  it("拗音を1セグメントにまとめる", () => {
    const segs = toSegments("しゃべる");
    expect(segs.map((s) => s.kana)).toEqual(["しゃ", "べ", "る"]);
  });

  it("1かなに複数のローマ字表記を持たせる", () => {
    const [shi] = toSegments("し");
    expect(shi.patterns).toContain("shi");
    expect(shi.patterns).toContain("si");
  });

  it("「ん」は後続が子音なら n 単独を許す", () => {
    const segs = toSegments("んだ");
    expect(segs[0].patterns).toContain("n");
    expect(segs[0].patterns).toContain("nn");
  });

  it("「ん」は後続が母音・な行・や行なら n 単独を許さない", () => {
    expect(toSegments("んあ")[0].patterns).not.toContain("n");
    expect(toSegments("んな")[0].patterns).not.toContain("n");
    expect(toSegments("んや")[0].patterns).not.toContain("n");
    // 末尾の「ん」も同様
    expect(toSegments("ん")[0].patterns).not.toContain("n");
  });

  it("「っ」は後続の子音1文字で確定できる", () => {
    // 「った」= t + ta。促音側に "tt" を持たせると母音が取り残される。
    const segs = toSegments("った");
    expect(segs[0].patterns).toContain("t");
    expect(segs[0].patterns).not.toContain("tt");
    expect(segs[0].patterns).toContain("ltu");
  });
});

describe("PhraseTyper — 表記ゆれの同時受理", () => {
  // 先行作『Typing Lyrics』はヘボン式/訓令式を事前選択させる。
  // 本エンジンは事前選択なしに両方を受理する。
  it.each([
    ["しんかい", "shinkai"],
    ["しんかい", "sinkai"],
    ["しんかい", "shinnkai"],
    ["しんかい", "sinnkai"],
  ])("「%s」を %s で打ち切れる", (kana, input) => {
    const typer = new PhraseTyper(toSegments(kana));
    const { commits, misses } = typeAll(typer, input);
    expect(misses).toBe(0);
    expect(typer.done).toBe(true);
    expect(commits).toBe(toSegments(kana).length);
  });

  it.each([
    ["じゃんぷ", "janpu"],
    ["じゃんぷ", "zyanpu"],
    ["じゃんぷ", "jyannpu"],
  ])("拗音「%s」を %s で打ち切れる", (kana, input) => {
    const typer = new PhraseTyper(toSegments(kana));
    const { misses } = typeAll(typer, input);
    expect(misses).toBe(0);
    expect(typer.done).toBe(true);
  });

  it("促音を子音重ねで打てる", () => {
    const typer = new PhraseTyper(toSegments("まって"));
    const { misses } = typeAll(typer, "matte");
    expect(misses).toBe(0);
    expect(typer.done).toBe(true);
  });

  it("促音を単独打ちでも打てる", () => {
    const typer = new PhraseTyper(toSegments("まって"));
    const { misses } = typeAll(typer, "maltute");
    expect(misses).toBe(0);
    expect(typer.done).toBe(true);
  });
});

describe("PhraseTyper — 確定タイミング", () => {
  it("かなは最後の1打鍵で確定する(打鍵数によらず1回)", () => {
    // 「し」は shi なら3打鍵、si なら2打鍵。どちらも commit は1回だけ。
    const a = new PhraseTyper(toSegments("し"));
    expect(typeAll(a, "shi").commits).toBe(1);
    const b = new PhraseTyper(toSegments("し"));
    expect(typeAll(b, "si").commits).toBe(1);
  });

  it("打鍵数が違ってもセグメント数(=リズム上の単位)は同じ", () => {
    // 「かし」= ka + shi。打鍵数は2+3=5 または 2+2=4 だが、
    // リズム判定の単位はどちらも2つ。
    expect(toSegments("かし")).toHaveLength(2);
  });
});

describe("PhraseTyper — ミスタイプ", () => {
  it("受理されない打鍵は miss を返し、バッファを壊さない", () => {
    const typer = new PhraseTyper(toSegments("かき"));
    expect(typer.input("k").type).toBe("progress");
    expect(typer.input("z").type).toBe("miss"); // ka/ki のどちらにもならない
    expect(typer.input("a").type).toBe("commit"); // ミス後も継続して打てる
    expect(typer.segmentIndex).toBe(1);
  });
});

describe("PhraseTyper — 入力ガイド", () => {
  it("次に受理されるキーを列挙できる", () => {
    const typer = new PhraseTyper(toSegments("し"));
    // shi / si / ci のいずれも受理するので、先頭キーは s と c
    expect(new Set(typer.nextKeys())).toEqual(new Set(["s", "c"]));
  });

  it("最短の残り打鍵をヒントとして出せる", () => {
    const typer = new PhraseTyper(toSegments("し"));
    expect(typer.hint()).toBe("si"); // shi(3打鍵)より短い si を提示
    typer.input("s");
    expect(typer.hint()).toBe("i");
  });
});

describe("PhraseTyper — 確定の遅延と確定時刻", () => {
  // 「ん」を n と打った時点では n で済ませるか nn と打つか判別できない。
  // 確定は保留し、次の打鍵で分岐させる。
  it("「ん」を n 1打鍵で済ませられる(後続が子音の場合)", () => {
    const typer = new PhraseTyper(toSegments("んだ"));
    expect(typer.input("n", 100).type).toBe("progress"); // 保留
    const r = typer.input("d", 200);
    expect(r.type).toBe("commit");
    if (r.type === "commit") {
      expect(r.segmentIndex).toBe(0);
      // 確定時刻は d を打った 200ms ではなく、n を打った 100ms
      expect(r.commitTime).toBe(100);
      expect(r.alsoMissed).toBe(false);
    }
    expect(typer.input("a", 300).type).toBe("commit");
    expect(typer.done).toBe(true);
  });

  it("「ん」を nn と打っても受理する", () => {
    const typer = new PhraseTyper(toSegments("んだ"));
    expect(typer.input("n", 100).type).toBe("progress");
    const r = typer.input("n", 150);
    expect(r.type).toBe("commit");
    if (r.type === "commit") expect(r.commitTime).toBe(150);
    typer.input("d", 200);
    expect(typer.input("a", 250).type).toBe("commit");
    expect(typer.done).toBe(true);
  });

  it("リズム判定に使う確定時刻が実際の打鍵時刻を保つ", () => {
    // 「し」を shi で打つと3打鍵。確定時刻は最後の i を打った時刻。
    const typer = new PhraseTyper(toSegments("し"));
    typer.input("s", 1000);
    typer.input("h", 1050);
    const r = typer.input("i", 1100);
    expect(r.type).toBe("commit");
    if (r.type === "commit") expect(r.commitTime).toBe(1100);
  });

  it("末尾の「ん」は flush で確定する", () => {
    const typer = new PhraseTyper(toSegments("ほん"));
    typer.input("h", 0);
    typer.input("o", 100);
    typer.input("n", 200); // 「ん」= nn/xn なので保留にはならず progress
    const r = typer.input("n", 250);
    expect(r.type).toBe("commit");
    expect(typer.done).toBe(true);
    expect(typer.flush()).toBeNull(); // 保留なしなら null
  });

  it("後続が子音のフレーズ末尾でも flush が効く", () => {
    // 「んだ」の「だ」まで打たず、n だけ打って終わった場合
    const typer = new PhraseTyper(toSegments("んだ"));
    typer.input("n", 100);
    expect(typer.done).toBe(false);
    const r = typer.flush();
    expect(r?.type).toBe("commit");
    if (r?.type === "commit") expect(r.commitTime).toBe(100);
    expect(typer.segmentIndex).toBe(1);
  });
});

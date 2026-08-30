/**
 * 成立性チェック(フェーズ0スパイクの代替)。
 *
 * TextAlive の実データはこの環境から取得できないため、実際のボカロ曲に近い
 * 密度のモック歌詞で「難易度ごとに要求打鍵速度が現実的な範囲に収まるか」を
 * 確認する。これがゲームとして成立するかの最初の関門。
 *
 * 実行: npx tsx src/feasibility.ts  (または vitest 経由)
 */
import { toSegments, PhraseTyper } from "./romaji";
import { selectNotes, requiredKps, type Note, type Difficulty } from "./judge";

/** BPM から16分音符1つあたりの ms を求める。 */
const sixteenth = (bpm: number) => (60 / bpm / 4) * 1000;

/**
 * 「早口のボカロ曲」を模したフレーズを作る。
 * BPM 170 で16分音符が連続する箇所は、ボカロ曲では珍しくない。
 */
export function mockPhrase(kana: string, bpm: number, startMs = 0): Note[] {
  const step = sixteenth(bpm);
  return toSegments(kana).map((seg, i) => ({
    kana: seg.kana,
    startTime: startMs + i * step,
  }));
}

export interface Report {
  difficulty: Difficulty;
  typedNotes: number;
  totalNotes: number;
  kps: number;
  verdict: string;
}

/** 打鍵速度の目安。日本語入力の実測値としてよく使われる水準。 */
function verdictFor(kps: number): string {
  if (kps <= 2.5) return "初心者でも可能";
  if (kps <= 4.5) return "一般的なプレイヤーで可能";
  if (kps <= 7) return "上級者向け";
  return "非現実的";
}

export function analyze(notes: Note[], strokesPerKana = 2): Report[] {
  const difficulties: Difficulty[] = ["EASY", "NORMAL", "HARD"];
  return difficulties.map((difficulty) => {
    const picked = selectNotes(notes, difficulty, strokesPerKana);
    const kps = requiredKps(notes, picked, strokesPerKana);
    return {
      difficulty,
      typedNotes: picked.length,
      totalNotes: notes.length,
      kps: Math.round(kps * 100) / 100,
      verdict: verdictFor(kps),
    };
  });
}

/** かな列の平均打鍵数を実測する(最短表記で打った場合)。 */
export function averageStrokes(kana: string): number {
  const segments = toSegments(kana);
  let strokes = 0;
  for (const seg of segments) {
    strokes += Math.min(...seg.patterns.map((p) => p.length));
  }
  return strokes / segments.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // 早口フレーズの例(16分音符連続、BPM 170)
  const kana = "きみのこえがきこえるまでずっとまってる";
  const bpm = 170;
  const notes = mockPhrase(kana, bpm);
  const spk = averageStrokes(kana);

  console.log(`フレーズ: ${kana}`);
  console.log(`かな数: ${notes.length} / BPM ${bpm} / 16分音符間隔 ${sixteenth(bpm).toFixed(1)}ms`);
  console.log(`平均打鍵数(最短表記): ${spk.toFixed(2)} 打鍵/かな\n`);

  for (const r of analyze(notes, spk)) {
    console.log(
      `${r.difficulty.padEnd(7)} 打鍵対象 ${String(r.typedNotes).padStart(2)}/${r.totalNotes}  ` +
        `要求 ${String(r.kps).padStart(5)} 打鍵/秒  → ${r.verdict}`
    );
  }

  // 先行入力を使えば、瞬間的な密度の山を均せることの確認
  console.log("\n--- 先行入力の効果 ---");
  const typer = new PhraseTyper(toSegments(kana));
  let strokes = 0;
  while (!typer.done) {
    const keys = typer.nextKeys();
    if (keys.length === 0) break;
    typer.input(keys[0], 0);
    strokes++;
    if (strokes > 200) break;
  }
  const spanSec = (notes[notes.length - 1].startTime - notes[0].startTime) / 1000;
  console.log(`全文字を打つのに必要な総打鍵数: ${strokes}`);
  console.log(`フレーズ長: ${spanSec.toFixed(2)} 秒`);
  console.log(
    `先行入力なしの要求速度: ${(strokes / spanSec).toFixed(2)} 打鍵/秒 → ${verdictFor(strokes / spanSec)}`
  );
}

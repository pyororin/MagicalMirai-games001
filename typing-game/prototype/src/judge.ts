/**
 * タイミング判定エンジン。
 *
 * 判定は「かな確定(commit)」の時刻に対して行う。打鍵ごとではない。
 * 先行入力(タイプアヘッド)を許し、発声より早く確定した分は TYPED として
 * 基礎点のみを与える。これにより「速い箇所は打ち貯めて曲に置いていかれない」
 * 「乗れる箇所はリズムで JUST を狙う」という2層の遊びが成立する。
 */

export type Grade = "JUST" | "GREAT" | "GOOD" | "TYPED" | "LATE" | "MISS";

export interface JudgeWindow {
  just: number;
  great: number;
  good: number;
  /** 発声開始からこれを過ぎた入力は LATE 扱い。 */
  late: number;
}

export const DEFAULT_WINDOW: JudgeWindow = {
  just: 100,
  great: 250,
  good: 450,
  late: 1200,
};

export const SCORE_MULTIPLIER: Record<Grade, number> = {
  JUST: 2.0,
  GREAT: 1.5,
  GOOD: 1.0,
  TYPED: 1.0,
  LATE: 0.5,
  MISS: 0,
};

/** 打鍵対象となる1文字(かな)。TextAlive の文字単位タイミングから作る。 */
export interface Note {
  kana: string;
  /** 発声開始時刻 (ms) */
  startTime: number;
}

export interface Judgement {
  index: number;
  grade: Grade;
  /** 発声時刻とのずれ (ms)。負なら先行。 */
  delta: number;
  score: number;
  combo: number;
}

/**
 * 隣接ノートと窓が重ならないようにクランプする。
 * 歌の発声は等間隔ではないため、固定窓のままだと速い箇所で
 * 前後のノートの判定域が食い合ってしまう。
 */
export function clampWindow(
  notes: Note[],
  index: number,
  base: JudgeWindow = DEFAULT_WINDOW
): JudgeWindow {
  const t = notes[index].startTime;
  const prevGap = index > 0 ? (t - notes[index - 1].startTime) / 2 : Infinity;
  const nextGap =
    index < notes.length - 1 ? (notes[index + 1].startTime - t) / 2 : Infinity;
  const limit = Math.min(prevGap, nextGap);
  return {
    just: Math.min(base.just, limit),
    great: Math.min(base.great, limit),
    good: Math.min(base.good, limit),
    late: base.late,
  };
}

/**
 * 1つのかな確定を判定する。
 *
 * @param commitTime かなが確定した時刻 (ms)
 * @param note       対象ノート
 * @param window     クランプ済みの判定ウィンドウ
 */
export function grade(
  commitTime: number,
  note: Note,
  window: JudgeWindow
): { grade: Grade; delta: number } {
  const delta = commitTime - note.startTime;
  const abs = Math.abs(delta);

  // 発声よりも十分早い確定は「先行入力」。ミスではなく基礎点を与える。
  if (delta < -window.good) return { grade: "TYPED", delta };

  if (abs <= window.just) return { grade: "JUST", delta };
  if (abs <= window.great) return { grade: "GREAT", delta };
  if (abs <= window.good) return { grade: "GOOD", delta };
  if (delta <= window.late) return { grade: "LATE", delta };
  return { grade: "MISS", delta };
}

const BASE_SCORE = 100;

/** コンボ倍率。伸ばしすぎると壊れるので上限を設ける。 */
export function comboMultiplier(combo: number): number {
  return Math.min(1 + Math.floor(combo / 10) * 0.1, 2.0);
}

/**
 * フレーズ全体のスコアリング。
 * commits は「n番目のノートが確定した時刻」の配列(未入力は null)。
 */
export function scorePhrase(
  notes: Note[],
  commits: (number | null)[],
  base: JudgeWindow = DEFAULT_WINDOW
): { judgements: Judgement[]; total: number; maxCombo: number } {
  const judgements: Judgement[] = [];
  let combo = 0;
  let maxCombo = 0;
  let total = 0;

  notes.forEach((note, i) => {
    const commitTime = commits[i];
    if (commitTime == null) {
      combo = 0;
      judgements.push({ index: i, grade: "MISS", delta: Infinity, score: 0, combo });
      return;
    }
    const w = clampWindow(notes, i, base);
    const { grade: g, delta } = grade(commitTime, note, w);
    if (g === "MISS") {
      combo = 0;
    } else {
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
    }
    const score = Math.round(
      BASE_SCORE * SCORE_MULTIPLIER[g] * comboMultiplier(combo)
    );
    total += score;
    judgements.push({ index: i, grade: g, delta, score, combo });
  });

  return { judgements, total, maxCombo };
}

/**
 * 難易度別の密度制御。
 *
 * 等速で全文字を打ち切るのは現実的でないため、打鍵対象を間引く。
 * 間引かれた文字は「自動で流れる歌詞」として表示のみ行う。
 */
export type Difficulty = "EASY" | "NORMAL" | "HARD";

/** 人間が持続的に打てる打鍵速度の目安 (打鍵/秒)。 */
const SUSTAINABLE_KPS: Record<Difficulty, number> = {
  EASY: 2.0,
  NORMAL: 4.0,
  HARD: Infinity,
};

/**
 * ノート列から、その難易度で実際に打たせるノートのインデックスを返す。
 * 直前に採用したノートから最小間隔が空くものだけを残す貪欲法。
 * フレーズ先頭は必ず残す(打ち始めを見失わせないため)。
 */
export function selectNotes(
  notes: Note[],
  difficulty: Difficulty,
  /** 1かなあたりの平均打鍵数。ローマ字はおよそ2打鍵。 */
  strokesPerKana = 2
): number[] {
  const kps = SUSTAINABLE_KPS[difficulty];
  if (kps === Infinity) return notes.map((_, i) => i);

  const minGapMs = (strokesPerKana / kps) * 1000;
  const picked: number[] = [];
  let lastTime = -Infinity;

  notes.forEach((note, i) => {
    if (i === 0 || note.startTime - lastTime >= minGapMs) {
      picked.push(i);
      lastTime = note.startTime;
    }
  });
  return picked;
}

/**
 * 実際に要求される打鍵速度 (打鍵/秒) を見積もる。成立性の確認に使う。
 *
 * n 個のノートの間には n-1 個の区間しかない。最初のノートは区間の開始時点で
 * 打ち終わっている必要がないため、打鍵ノルマは (n-1) 個分で数える。
 */
export function requiredKps(
  notes: Note[],
  indices: number[],
  strokesPerKana = 2
): number {
  if (indices.length < 2) return 0;
  const first = notes[indices[0]].startTime;
  const last = notes[indices[indices.length - 1]].startTime;
  const seconds = (last - first) / 1000;
  if (seconds <= 0) return Infinity;
  return ((indices.length - 1) * strokesPerKana) / seconds;
}

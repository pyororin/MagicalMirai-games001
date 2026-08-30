/**
 * ローマ字入力エンジン。
 *
 * 設計の要:
 * - かな列を「セグメント」に分割する。拗音(きゃ)は2文字で1セグメント=1音節。
 * - 各セグメントは複数のローマ字表記を同時に受理する(shi/si、ja/zya/jya ...)。
 *   プレイヤーに打ち方を強制しない。これが先行作『Typing Lyrics』(ヘボン式/訓令式を
 *   事前選択させる方式)との差別化点。
 * - 「ん」と「っ」は後続セグメントに依存するため、解決時に文脈を見て候補を生成する。
 *
 * リズム判定はセグメント(=かな)が確定した瞬間に行う。打鍵ごとではない。
 * これにより「し=shi(3打鍵)」も「か=ka(2打鍵)」もリズム上は等価に扱える。
 */

/** 拗音などの2文字セグメント。最長一致で優先的に切り出す。 */
const DIGRAPHS: Record<string, string[]> = {
  きゃ: ["kya"], きゅ: ["kyu"], きょ: ["kyo"], きぇ: ["kye"], きぃ: ["kyi"],
  ぎゃ: ["gya"], ぎゅ: ["gyu"], ぎょ: ["gyo"], ぎぇ: ["gye"],
  しゃ: ["sha", "sya"], しゅ: ["shu", "syu"], しょ: ["sho", "syo"], しぇ: ["she", "sye"],
  じゃ: ["ja", "zya", "jya"], じゅ: ["ju", "zyu", "jyu"], じょ: ["jo", "zyo", "jyo"], じぇ: ["je", "zye", "jye"],
  ちゃ: ["cha", "tya", "cya"], ちゅ: ["chu", "tyu", "cyu"], ちょ: ["cho", "tyo", "cyo"], ちぇ: ["che", "tye", "cye"],
  にゃ: ["nya"], にゅ: ["nyu"], にょ: ["nyo"], にぇ: ["nye"],
  ひゃ: ["hya"], ひゅ: ["hyu"], ひょ: ["hyo"], ひぇ: ["hye"],
  びゃ: ["bya"], びゅ: ["byu"], びょ: ["byo"], びぇ: ["bye"],
  ぴゃ: ["pya"], ぴゅ: ["pyu"], ぴょ: ["pyo"], ぴぇ: ["pye"],
  みゃ: ["mya"], みゅ: ["myu"], みょ: ["myo"], みぇ: ["mye"],
  りゃ: ["rya"], りゅ: ["ryu"], りょ: ["ryo"], りぇ: ["rye"],
  ふぁ: ["fa", "hwa"], ふぃ: ["fi", "hwi"], ふぇ: ["fe", "hwe"], ふぉ: ["fo", "hwo"],
  ふゅ: ["fyu"],
  てぃ: ["thi", "texi"], でぃ: ["dhi", "dexi"], とぅ: ["twu"], どぅ: ["dwu"],
  うぃ: ["wi", "whi"], うぇ: ["we", "whe"], うぉ: ["who"],
  ゔぁ: ["va"], ゔぃ: ["vi"], ゔぇ: ["ve"], ゔぉ: ["vo"],
  つぁ: ["tsa"], つぃ: ["tsi"], つぇ: ["tse"], つぉ: ["tso"],
};

/** 単一かなのローマ字候補。 */
const MONOGRAPHS: Record<string, string[]> = {
  あ: ["a"], い: ["i", "yi"], う: ["u", "wu", "whu"], え: ["e"], お: ["o"],
  か: ["ka", "ca"], き: ["ki"], く: ["ku", "cu", "qu"], け: ["ke"], こ: ["ko", "co"],
  が: ["ga"], ぎ: ["gi"], ぐ: ["gu"], げ: ["ge"], ご: ["go"],
  さ: ["sa"], し: ["shi", "si", "ci"], す: ["su"], せ: ["se", "ce"], そ: ["so"],
  ざ: ["za"], じ: ["ji", "zi"], ず: ["zu"], ぜ: ["ze"], ぞ: ["zo"],
  た: ["ta"], ち: ["chi", "ti"], つ: ["tsu", "tu"], て: ["te"], と: ["to"],
  だ: ["da"], ぢ: ["di"], づ: ["du"], で: ["de"], ど: ["do"],
  な: ["na"], に: ["ni"], ぬ: ["nu"], ね: ["ne"], の: ["no"],
  は: ["ha"], ひ: ["hi"], ふ: ["fu", "hu"], へ: ["he"], ほ: ["ho"],
  ば: ["ba"], び: ["bi"], ぶ: ["bu"], べ: ["be"], ぼ: ["bo"],
  ぱ: ["pa"], ぴ: ["pi"], ぷ: ["pu"], ぺ: ["pe"], ぽ: ["po"],
  ま: ["ma"], み: ["mi"], む: ["mu"], め: ["me"], も: ["mo"],
  や: ["ya"], ゆ: ["yu"], よ: ["yo"],
  ら: ["ra"], り: ["ri"], る: ["ru"], れ: ["re"], ろ: ["ro"],
  わ: ["wa"], を: ["wo"], ゔ: ["vu"],
  ぁ: ["la", "xa"], ぃ: ["li", "xi"], ぅ: ["lu", "xu"], ぇ: ["le", "xe"], ぉ: ["lo", "xo"],
  ゃ: ["lya", "xya"], ゅ: ["lyu", "xyu"], ょ: ["lyo", "xyo"],
  っ: ["ltu", "xtu", "ltsu"],
  ー: ["-"],
};

/** 促音の後に子音重ねを許すかの判定に使う。 */
const VOWELS = new Set(["a", "i", "u", "e", "o"]);

export interface Segment {
  /** 表示上のかな(1〜2文字) */
  kana: string;
  /** 受理するローマ字表記の全パターン */
  patterns: string[];
}

/**
 * かな列をセグメントに分割し、各セグメントの受理パターンを解決する。
 *
 * 文脈依存の処理:
 * - 「ん」: 次が母音・な行・や行・末尾なら "nn"/"xn" のみ。それ以外は "n" も許す。
 * - 「っ」: 次のセグメントの先頭子音を重ねた形を許す(例 「った」= tta)。
 *          単独打ち(ltu/xtu)も残す。
 */
export function toSegments(kana: string): Segment[] {
  const raw: string[] = [];
  for (let i = 0; i < kana.length; ) {
    const two = kana.slice(i, i + 2);
    if (DIGRAPHS[two]) {
      raw.push(two);
      i += 2;
    } else {
      raw.push(kana[i]);
      i += 1;
    }
  }

  const segments: Segment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i];
    const next = raw[i + 1];

    if (k === "ん") {
      segments.push({ kana: k, patterns: sokuonSafeN(next) });
      continue;
    }

    if (k === "っ") {
      // 「った」= t + ta。促音そのものは子音1文字で確定し、重なりは
      // 後続セグメントの打鍵で完成する。促音側に "tt" を持たせると
      // 後続の母音だけが取り残されるため誤り。
      const patterns = [...MONOGRAPHS["っ"]];
      const nextHeads = next ? headConsonants(next) : [];
      for (const c of nextHeads) patterns.push(c);
      segments.push({ kana: k, patterns: dedupe(patterns) });
      continue;
    }

    const patterns = DIGRAPHS[k] ?? MONOGRAPHS[k];
    if (!patterns) {
      // 想定外の文字(記号など)は打鍵対象から外す。呼び出し側で除去済みが前提。
      continue;
    }
    segments.push({ kana: k, patterns: [...patterns] });
  }
  return segments;
}

/** 「ん」を n 一文字で確定してよいかは後続に依存する。 */
function sokuonSafeN(next: string | undefined): string[] {
  const base = ["nn", "xn"];
  if (!next) return base;
  const heads = headConsonants(next);
  // 後続が母音始まり / な行 / や行 だと "n" 単独では曖昧になるため許可しない。
  const ambiguous = heads.length === 0 || heads[0] === "n" || heads[0] === "y";
  return ambiguous ? base : ["n", ...base];
}

/** セグメントが取りうるローマ字表記の先頭子音の集合。 */
function headConsonants(kana: string): string[] {
  const patterns = DIGRAPHS[kana] ?? MONOGRAPHS[kana] ?? [];
  const heads = new Set<string>();
  for (const p of patterns) {
    const c = p[0];
    if (c && !VOWELS.has(c) && c !== "-") heads.add(c);
  }
  return [...heads];
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

export type KeyResult =
  | { type: "progress" }
  | {
      type: "commit";
      segmentIndex: number;
      /**
       * 確定時刻。確定が遅延した場合(「ん」の n/nn 分岐など)は、
       * 実際に打鍵された時刻ではなく、確定が確定した打鍵の時刻を返す。
       * リズム判定はこの時刻を使う。
       */
      commitTime: number;
      /** この打鍵が後続セグメントで受理されなかった場合に true。 */
      alsoMissed?: boolean;
    }
  | { type: "miss" };

/**
 * 1フレーズ分の打鍵ステートマシン。
 *
 * 打鍵ごとに現在セグメントの候補を絞り込み、いずれかに完全一致した時点で
 * 「かな確定(commit)」を返す。リズム判定はこの commit の時刻に対して行う。
 */
export class PhraseTyper {
  private index = 0;
  private buffer = "";

  constructor(readonly segments: Segment[]) {}

  get segmentIndex(): number {
    return this.index;
  }

  get done(): boolean {
    return this.index >= this.segments.length;
  }

  /** 現在の未確定バッファ(表示用)。 */
  get pending(): string {
    return this.buffer;
  }

  /** 現時点で受理される次の打鍵の集合。ガイド表示や入力補助に使う。 */
  nextKeys(): string[] {
    if (this.done) return [];
    const cands = this.candidates();
    return dedupe(cands.map((p) => p[this.buffer.length]).filter(Boolean));
  }

  /** 残りを最短で打ち切るローマ字列(ガイド表示用)。 */
  hint(): string {
    if (this.done) return "";
    const cands = this.candidates();
    const shortest = cands.reduce((a, b) => (b.length < a.length ? b : a));
    return shortest.slice(this.buffer.length);
  }

  private candidates(): string[] {
    const seg = this.segments[this.index];
    return seg.patterns.filter((p) => p.startsWith(this.buffer));
  }

  /** 完全一致しているが、より長い候補も残っている状態の確定時刻。 */
  private pendingTime = 0;

  /**
   * 1打鍵を処理する。
   *
   * 確定の遅延がこのエンジンの肝。「ん」を n と打った時点では、
   * プレイヤーが n(1打鍵)で済ませるつもりか nn と打つつもりか判別できない。
   * そこで完全一致してもより長い候補が残っている間は確定を保留し、
   * 次の打鍵で分岐させる。ただしリズム判定に使う確定時刻は
   * 保留を開始した打鍵の時刻(=実際に「ん」を打った瞬間)を保持する。
   *
   * @param key  打鍵された文字
   * @param time 打鍵時刻 (ms)。判定に使う。
   */
  input(key: string, time = 0): KeyResult {
    if (this.done) return { type: "miss" };
    const seg = this.segments[this.index];
    const attempt = this.buffer + key;
    const matches = seg.patterns.filter((p) => p.startsWith(attempt));

    if (matches.length > 0) {
      this.buffer = attempt;
      const exact = matches.includes(attempt);
      const hasLonger = matches.some((p) => p.length > attempt.length);
      if (exact && !hasLonger) return this.commit(time);
      if (exact) this.pendingTime = time; // 確定を保留
      return { type: "progress" };
    }

    // 現セグメントでは受理できない。保留中の確定があれば、それを成立させて
    // この打鍵を次セグメントの1打鍵目として扱う(「んだ」の n → d など)。
    if (this.buffer.length > 0 && seg.patterns.includes(this.buffer)) {
      const committed = this.index;
      const commitTime = this.pendingTime;
      this.index += 1;
      this.buffer = "";
      const next = this.input(key, time);
      return {
        type: "commit",
        segmentIndex: committed,
        commitTime,
        alsoMissed: next.type === "miss",
      };
    }

    return { type: "miss" };
  }

  /**
   * 保留中の確定を締める。フレーズが「ん」で終わる場合、n を1打鍵しただけでは
   * 保留状態のまま終わってしまうため、フレーズ終端で呼ぶ。
   */
  flush(): KeyResult | null {
    if (this.done || this.buffer.length === 0) return null;
    const seg = this.segments[this.index];
    if (!seg.patterns.includes(this.buffer)) return null;
    const committed = this.index;
    const commitTime = this.pendingTime;
    this.index += 1;
    this.buffer = "";
    return { type: "commit", segmentIndex: committed, commitTime };
  }

  private commit(time: number): KeyResult {
    const committed = this.index;
    this.index += 1;
    this.buffer = "";
    return { type: "commit", segmentIndex: committed, commitTime: time };
  }
}

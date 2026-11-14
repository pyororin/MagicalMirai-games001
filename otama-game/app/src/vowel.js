// 母音(あいうえお)まわり。歌詞の「読み」から母音を取り出す純関数と、
// 5つの母音 = 5つの顔 = 5つのピンチ操作の対応表。
//
//   あ … 触れていない(ふつうの顔)
//   い … ほっぺを横にのばす        (横・外向きピンチ)
//   う … ほっぺを両側から押さえる  (横・内向きピンチ)
//   え … 顔をたてに押しつぶす      (縦・内向きピンチ)
//   お … たてにのばす=Oの口        (縦・外向きピンチ)

export const VOWELS = ["a", "i", "u", "e", "o"];
export const VOWEL_KANA = { a: "あ", i: "い", u: "う", e: "え", o: "お" };

/** ジェスチャの定義。axis: h|v|null / dir: out|in|null */
export const GESTURE = {
  a: { axis: null, dir: null, label: "さわるだけ" },
  i: { axis: "h", dir: "out", label: "横にひろげる" },
  u: { axis: "h", dir: "in", label: "横からおさえる" },
  e: { axis: "v", dir: "in", label: "たてにつぶす" },
  o: { axis: "v", dir: "out", label: "たてにひろげる" },
};

/** (軸, 向き) → 母音。ピンチ検出側はこれだけ使う。 */
export function vowelOfGesture(axis, dir) {
  if (!axis || !dir) return "a";
  for (const v of VOWELS) if (GESTURE[v].axis === axis && GESTURE[v].dir === dir) return v;
  return "a";
}

const ROW = {
  a: "あかさたなはまやらわがざだばぱぁゃゎ",
  i: "いきしちにひみりぎじぢびぴぃ",
  u: "うくすつぬふむゆるぐずづぶぷぅゅゔ",
  e: "えけせてねへめれげぜでべぺぇ",
  o: "おこそとのほもよろをごぞどぼぽぉょ",
};
const KANA2V = {};
for (const v of VOWELS) for (const ch of ROW[v]) KANA2V[ch] = v;
KANA2V["ん"] = "u"; // 口を閉じていく音。いちばん口がすぼまる「う」に寄せる

export function toHira(s) {
  return String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const SMALL_Y = "ゃゅょ";
const SMALL_V = "ぁぃぅぇぉゎ";

/** かな1文字の母音。かな以外・っ・ー は null。 */
export function kanaVowel(ch) {
  return KANA2V[toHira(ch)] || null;
}

/**
 * 読み(ひらがな/カタカナ)をモーラ列に分ける。
 *  - 拗音(きゃ)・小書き母音(ふぁ)は直前の文字と1モーラ。母音は小書き文字側
 *  - 「ー」は直前のモーラを伸ばす(ext を足す。新しいモーラにはしない)
 *  - 「っ」は無音(休符)なのでモーラにしない
 * @returns {{kana:string, v:string, ext:number}[]}
 */
export function splitMoras(reading) {
  const out = [];
  const s = toHira(reading || "");
  for (const ch of s) {
    if (ch === "ー" || ch === "〜" || ch === "～") {
      if (out.length) out[out.length - 1].ext++;
      continue;
    }
    if (ch === "っ") continue;
    if (SMALL_Y.includes(ch) || SMALL_V.includes(ch)) {
      if (out.length) {
        const m = out[out.length - 1];
        m.kana += ch;
        m.v = KANA2V[ch] || m.v;
      }
      continue;
    }
    const v = KANA2V[ch];
    if (v) out.push({ kana: ch, v, ext: 0 });
  }
  return out;
}

/** 読みが取れない文字(漢字で読みデータ無し等)に、決定的に母音を割り当てる。 */
export function fallbackVowel(text, salt = 0) {
  const c = String(text).codePointAt(0) || 0;
  return VOWELS[(c * 7 + salt * 3) % 5];
}

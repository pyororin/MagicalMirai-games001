// マジカルミライ 2025 楽曲コンテスト受賞6曲。値は ontology/textalive.yaml の contest-songs-2025
// (公式サンプルから採取した実測値)。card は /cards/resolve を事前解決した URL で、
// "Card data resolver is unavailable" のときのフォールバックに使う。
export const SONGS = [
  { code: "a1e582e4c", title: "ロンリーラン / 海風太陽", url: "https://piapro.jp/t/CyPO/20250128183915",
    card: "https://api.textalive.jp/cards/Rv6F3kEafnB2ZmKC",
    video: { beatId: 4694280, chordId: 2830735, repetitiveSegmentId: 2946483, lyricId: 67815, lyricDiffId: 20659 } },
  { code: "a7a0a6399", title: "ストリートライト / 加賀(ネギシャワーP)", url: "https://piapro.jp/t/ULcJ/20250205120202",
    card: "https://api.textalive.jp/cards/mOVlJ15TwK3mGacP",
    video: { beatId: 4694275, chordId: 2830730, repetitiveSegmentId: 2946478, lyricId: 67810, lyricDiffId: 20654 } },
  { code: "ad72acbb3", title: "アリフレーション / 雨良 Amala", url: "https://piapro.jp/t/SuQO/20250127235813",
    card: "https://api.textalive.jp/cards/tHF561bSn3il7uGQ",
    video: { beatId: 4694276, chordId: 2830731, repetitiveSegmentId: 2946479, lyricId: 67811, lyricDiffId: 20655 } },
  { code: "aa8818139", title: "インフォーマルダイブ / 99piano", url: "https://piapro.jp/t/Ppc9/20241224135843",
    card: "https://api.textalive.jp/cards/H3zE3TtWn8pMU4Qd",
    video: { beatId: 4694277, chordId: 2830732, repetitiveSegmentId: 2946480, lyricId: 67812, lyricDiffId: 20656 } },
  { code: "a7df4cda6", title: "ハロー、フェルミ。/ ど～ぱみん", url: "https://piapro.jp/t/oTaJ/20250204234235",
    card: "https://api.textalive.jp/cards/ekhSl1QaKHtRrBCW",
    video: { beatId: 4694278, chordId: 2830733, repetitiveSegmentId: 2946481, lyricId: 67813, lyricDiffId: 20657 } },
  { code: "a7f2f7f99", title: "パレードレコード / きさら", url: "https://piapro.jp/t/GCgy/20250202202635",
    card: "https://api.textalive.jp/cards/fAoEqWsPQx12kZsC",
    video: { beatId: 4694279, chordId: 2830734, repetitiveSegmentId: 2946482, lyricId: 67814, lyricDiffId: 20658 } },
];

/** サブディレクトリ配下(Pages)でも解決できるよう baseURI から組み立てる。?v= はキャッシュ避け。 */
export function dataUrl(path, build) {
  return new URL(path + (build ? "?v=" + build : ""), document.baseURI).href;
}

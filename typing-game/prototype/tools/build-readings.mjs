/**
 * 歌詞の読み(ふりがな)を事前生成する。
 *
 * TextAlive の文字単位データ(char.text)は表示文字であり読みを持たないため
 * (ontology: no-reading-data-for-kanji)、漢字を打鍵対象にするには読みが要る。
 * ここでビルド時に生成して data/readings/<songCode>.json へ書き出し、
 * アプリは実行時に fetch するだけにする(実行時の形態素解析なし)。
 *
 *   node tools/build-readings.mjs            # 課題曲6曲すべて
 *   node tools/build-readings.mjs CyPO       # URL に該当する曲だけ
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import kuromoji from "kuromoji";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "data", "readings");
const DIC_DIR = path.join(HERE, "..", "node_modules", "kuromoji", "dict");
const APP_TOKEN = process.env.TEXTALIVE_TOKEN || "VQRxHB1a0q8fVvnm";

// ontology/textalive.yaml の contest-songs-2025
const SONGS = [
  { title: "ロンリーラン / 海風太陽",            card: "https://api.textalive.jp/cards/Rv6F3kEafnB2ZmKC", url: "https://piapro.jp/t/CyPO/20250128183915" },
  { title: "ストリートライト / 加賀(ネギシャワーP)", card: "https://api.textalive.jp/cards/mOVlJ15TwK3mGacP", url: "https://piapro.jp/t/ULcJ/20250205120202" },
  { title: "アリフレーション / 雨良 Amala",       card: "https://api.textalive.jp/cards/tHF561bSn3il7uGQ", url: "https://piapro.jp/t/SuQO/20250127235813" },
  { title: "インフォーマルダイブ / 99piano",      card: "https://api.textalive.jp/cards/H3zE3TtWn8pMU4Qd", url: "https://piapro.jp/t/Ppc9/20241224135843" },
  { title: "ハロー、フェルミ。/ ど～ぱみん",       card: "https://api.textalive.jp/cards/ekhSl1QaKHtRrBCW", url: "https://piapro.jp/t/oTaJ/20250204234235" },
  { title: "パレードレコード / きさら",           card: "https://api.textalive.jp/cards/fAoEqWsPQx12kZsC", url: "https://piapro.jp/t/GCgy/20250202202635" },
];

const KATA = /[ァ-ヶ]/;
const HIRA = /[ぁ-ゖ]/;
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isKanaChar = (c) => HIRA.test(c) || KATA.test(c) || c === "ー" || c === "ゝ" || c === "ヽ";

/** かな以外(漢字・英数)の連続を1つの読みへまとめ、かなの連続は自分自身が読みになる */
function splitRuns(surface) {
  const runs = [];
  for (const ch of surface) {
    const kana = isKanaChar(ch);
    const last = runs[runs.length - 1];
    if (last && last.kana === kana) last.text += ch;
    else runs.push({ kana, text: ch });
  }
  return runs;
}

/** モーラ境界を壊さない位置で読みを n 分割する(拗音・促音・長音は前の文字にくっつける) */
function splitMorae(reading, n) {
  const morae = [];
  for (const ch of reading) {
    if (morae.length && "ゃゅょぁぃぅぇぉっーゎ".includes(ch)) morae[morae.length - 1] += ch;
    else morae.push(ch);
  }
  const out = new Array(n).fill("");
  if (!morae.length) return out;
  // 文字数で按分(端数は後ろの文字に寄せる)
  for (let i = 0; i < morae.length; i++) out[Math.min(n - 1, Math.floor((i * n) / morae.length))] += morae[i];
  return out;
}

/**
 * 表層形 surface と読み reading を1文字ずつ対応づける。
 * 「見失う/ミウシナウ」のように内部・末尾にかなを含む語も、かな部分を
 * アンカーにして漢字部分の読みを切り出す(候補が複数あるためバックトラックする)。
 * 対応づけに失敗したら先頭文字へまとめる。
 */
function alignReading(surface, reading) {
  const chars = [...surface];
  const runs = splitRuns(surface);
  const R = toHira(reading);

  function walk(i, pos) {
    if (i === runs.length) return pos === R.length ? [] : null;
    const run = runs[i];
    if (run.kana) {
      const want = toHira(run.text);
      if (R.slice(pos, pos + want.length) !== want) return null;
      const rest = walk(i + 1, pos + want.length);
      return rest && [...run.text].map(toHira).concat(rest);
    }
    const n = [...run.text].length;
    const last = i === runs.length - 1;
    for (let end = last ? R.length : pos + 1; end <= R.length; end++) {
      const rest = walk(i + 1, end);
      if (rest) return splitMorae(R.slice(pos, end), n).concat(rest);
      if (last) break;
    }
    return null;
  }

  return walk(0, 0) || fallback(chars, R);
}
function fallback(chars, R) {
  return chars.map((c, i) => (i === 0 ? R : ""));
}

async function fetchLyricText(lyricUrl) {
  const res = await fetch(lyricUrl, { headers: { "user-agent": "Mozilla/5.0 daken-mirai-readings" } });
  if (!res.ok) throw new Error(`歌詞ページ取得に失敗: HTTP ${res.status} ${lyricUrl}`);
  const html = await res.text();
  const m = html.match(/<div class="contents_text_txt">\s*<p>([\s\S]*?)<\/p>/);
  if (!m) throw new Error(`歌詞本文を抽出できませんでした: ${lyricUrl}`);
  return m[1]
    .replace(/<br\s*\/?>\r?\n?/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/&#0*39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\r/g, "")
    .trim();
}

const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath: DIC_DIR }).build((err, t) => (err ? reject(err) : resolve(t))));

const filter = process.argv[2];
await fs.mkdir(OUT_DIR, { recursive: true });
const index = [];

for (const song of SONGS) {
  if (filter && !song.url.includes(filter)) continue;
  const card = await (await fetch(song.card, { headers: { "x-ta-app-token": APP_TOKEN } })).json();
  const code = card.song?.code;
  const lyricUrl = card.lyrics?.url;
  if (!code || !lyricUrl) throw new Error(`カード情報が不足: ${song.title}`);

  const text = await fetchLyricText(lyricUrl);
  const readings = [];
  let unmatched = 0;
  for (const line of text.split("\n")) {
    for (const token of tokenizer.tokenize(line)) {
      const surface = token.surface_form;
      const reading = token.reading && token.reading !== "*" ? token.reading : surface;
      const aligned = [...surface].every((c) => !isKanaChar(c) && !/[一-鿿々]/.test(c))
        ? [...surface].map(() => "")                       // 記号・英数は打鍵対象外
        : alignReading(surface, reading);
      if (aligned.length !== [...surface].length) throw new Error(`整列に失敗: ${surface}`);
      if (aligned.length === 1 && /[一-鿿]/.test(surface) && !aligned[0]) unmatched++;
      readings.push(...aligned);
    }
    readings.push("");                                     // 改行ぶん
  }
  readings.pop();

  const flat = [...text];
  if (flat.length !== readings.length) throw new Error(`文字数不一致: ${flat.length} vs ${readings.length}`);

  const out = {
    song: song.title, songUrl: song.url, code, lyricUrl,
    generator: "tools/build-readings.mjs (kuromoji ipadic)",
    note: "text の1文字に readings の1要素が対応する。誤読は readings を直接手修正してよい。",
    text, readings,
  };
  const file = path.join(OUT_DIR, `${code}.json`);
  await fs.writeFile(file, JSON.stringify(out, null, 1) + "\n");
  const kanji = flat.filter((c) => /[一-鿿々]/.test(c)).length;
  console.log(`${song.title}\n  → ${path.relative(process.cwd(), file)}  ${flat.length}文字 (漢字 ${kanji}, 読み未取得 ${unmatched})`);
  index.push({ code, song: song.title, songUrl: song.url });
}

if (!filter) {
  await fs.writeFile(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 1) + "\n");
  console.log(`index.json に ${index.length} 曲`);
}

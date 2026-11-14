// TextAlive のカード JSON(拍・コード・歌詞の時刻)と、typing-game で事前生成した
// 読みデータ(歌詞本文+ひらがな)を突き合わせ、オフラインで譜面を作れる曲データを出力する。
//
//   node tools/build-songs.mjs            # カードを curl で取得して data/songs/*.json を生成
//
// 出力は「曲そのもの」ではなく、拍・コード・歌詞の時刻と文字だけ(音源は含まない)。
// アプリ本体は実行時に Player から同じ形を作る。これは
//   1) ?demo=1 で TextAlive 無しに遊ぶ  2) 譜面生成の単体テスト
// のための固定データ。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const readingsDir = join(root, "..", "typing-game", "prototype", "data", "readings");
const outDir = join(root, "app", "data", "songs");
const TOKEN = "VQRxHB1a0q8fVvnm"; // 公開前提のアプリトークン(ontology/textalive.yaml 参照)

// ontology/textalive.yaml の contest-songs-2025
const SONGS = [
  { code: "a1e582e4c", card: "Rv6F3kEafnB2ZmKC" },
  { code: "a7a0a6399", card: "mOVlJ15TwK3mGacP" },
  { code: "ad72acbb3", card: "tHF561bSn3il7uGQ" },
  { code: "aa8818139", card: "H3zE3TtWn8pMU4Qd" },
  { code: "a7df4cda6", card: "ekhSl1QaKHtRrBCW" },
  { code: "a7f2f7f99", card: "fAoEqWsPQx12kZsC" },
];

function fetchCard(id) {
  const buf = execFileSync(
    "curl",
    ["-sS", "-m", "60", "-H", `x-ta-app-token: ${TOKEN}`, `https://api.textalive.jp/cards/${id}`],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  return JSON.parse(buf.toString("utf8"));
}

const r1 = (x) => Math.round(x);
mkdirSync(outDir, { recursive: true });
const index = [];

for (const s of SONGS) {
  const card = fetchCard(s.card);
  const rd = JSON.parse(readFileSync(join(readingsDir, `${s.code}.json`), "utf8"));

  // 読みデータ: text の空白以外の1文字に readings の1要素が対応する
  const text = [...rd.text];
  const chars = [];
  const readings = [];
  text.forEach((ch, i) => {
    if (/\s/.test(ch)) return;
    chars.push(ch);
    readings.push(rd.readings[i] || "");
  });

  const phrases = [];
  let k = 0;
  for (const ph of card.lyrics.phrases) {
    const cs = [];
    for (const w of ph.words) {
      w.characters.forEach((c, i) => {
        // [表示文字, 読み, 開始ms, 終了ms, 語頭フラグ]
        cs.push([chars[k], readings[k], r1(c.startTime), r1(c.endTime), i === 0 ? 1 : 0]);
        k++;
      });
    }
    phrases.push({ s: cs[0][2], e: cs[cs.length - 1][3], chars: cs });
  }
  if (k !== chars.length) throw new Error(`${s.code}: 文字数が合わない card=${k} text=${chars.length}`);

  const song = {
    code: s.code,
    title: card.song.name,
    artist: card.song.artistName,
    url: card.song.permalink,
    // [開始ms, 小節内の拍位置(1始まり), 1小節の拍数]
    beats: card.analysis.beats.map((b) => [r1(b.startTime), b.position, b.length]),
    // [開始ms, 終了ms, コード名]。無和音(N)は落とす
    chords: card.analysis.chords.filter((c) => c.name && c.name !== "N").map((c) => [r1(c.startTime), r1(c.endTime), c.name]),
    phrases,
  };
  writeFileSync(join(outDir, `${s.code}.json`), JSON.stringify(song));
  index.push({ code: s.code, title: `${song.title} / ${song.artist}`, url: song.url });
  console.log(s.code, song.title, "beats", song.beats.length, "chords", song.chords.length, "chars", chars.length);
}
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 1));

# miku-twintail app (P1)

TextAlive App API に接続した実データ版。楽曲は開発用デフォルトとして
マジカルミライ 2025 課題曲「ロンリーラン / 海風太陽」を読み込む
（TextAlive ホスト接続時はホスト指定の曲が優先される）。

## 動かし方

```sh
cd miku-twintail/app
npm install
npm run dev     # http://localhost:5173
```

「▶ 再生」で曲が始まる。歌唱中にドラッグでツインテールを 2 本描くと、
描いている間に歌われていた歌詞の文字が髪になる。サビ突入で自動的にミク度判定。

## ホスト接続テスト（応募時の挙動）

[TextAlive App Debugger](https://developer.textalive.jp/app/) の App URL 欄に
`http://localhost:5173` を入力する。ホスト接続中は再生コントロールが自動で消え、
再生・シーク・曲変更はホスト側から行う。

## モックとの対応

| 擬似層（prototype/index.html） | 本アプリ |
| --- | --- |
| BPM 固定の onBeat | `player.findBeat(pos).progress(pos)` |
| vocalActive / vocalAmp | `video.findPhrase(pos)` / `getVocalAmplitude(pos)`（`getMaxVocalAmplitude()` で正規化） |
| 固定文字列 LYRICS | 描画中に `video.findChar(pos)` で拾った実歌詞 |
| WebAudio 擬似曲 | `mediaElement` の楽曲再生 |
| 手動ミク度判定のみ | `findChorus(pos)` の立ち上がりで自動判定（手動ボタンも残置） |

トークンは TextAlive の仕様上クライアントに埋め込む前提のもの（公式サンプルも同様）。
アプリ URL を公開する際は TextAlive for Developers 側のアプリ登録情報を合わせて更新する。

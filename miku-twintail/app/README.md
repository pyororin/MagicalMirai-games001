# miku-twintail app

リズムゲーム本体と、2 つのページ（実曲版 / 擬似曲版）。
ゲーム本体は `src/game/`、楽曲との接点は `src/song/` のアダプタに閉じてある。

## 動かし方

```sh
cd miku-twintail/app
npm ci
npm run dev
#   http://localhost:5173/            実曲版（TextAlive 接続）
#   http://localhost:5173/mock.html   擬似曲版（通信・トークン不要）
npm run build   # dist/ に index.html と mock.html を出力
```

## ページ

| ページ | 楽曲 | 用途 |
| --- | --- | --- |
| `index.html` | TextAlive App API（課題曲 6 曲＋任意 URL） | 本命。`?song=0`〜`?song=5` で曲を直接指定 |
| `mock.html` | 自前合成の 130BPM 擬似曲 | 手触り・判定・ミク度の検証。`?bars=8&bpm=100` で尺とテンポを変更 |

どちらも**同じ `src/game/core.js`** が動く。違いはソングアダプタだけ。

## ソングアダプタの契約

`core.js` は楽曲を次の 9 つ（＋任意の `start`）越しにしか触らない。

| 関数 | 意味 |
| --- | --- |
| `ready()` | 楽曲データが揃ったか |
| `time()` | 再生位置 [sec] |
| `atAudio(songSec)` | その曲時刻に対応する AudioContext 時刻（効果音の先読み予約用） |
| `beat(k)` | k 番目の拍 `{t, pos, bar, dur, last}` |
| `bar(i)` | i 番目の小節 `{i, beats, tapIdx, tap, done, dur}` |
| `barIndexAt(sec)` | その時刻の小節番号 |
| `onBeat(beat, at)` | 拍ごとの伴奏（擬似曲のみ実装） |
| `charAt(sec)` | 発声中の文字（伸ばした髪に流れ込む） |
| `vocalAt(sec)` | ボーカル音量 0..1 |
| `ended()` | 曲が終わったか |

## ホスト接続テスト（応募時の挙動）

[TextAlive App Debugger](https://developer.textalive.jp/app/) の App URL 欄に
`http://localhost:5173` を入力する。ホスト接続中（`app.managed`）は選曲・再生 UI が消え、
再生・シーク・曲変更はホスト側から行う。曲が差し替わると `onAppMediaChange` で
ゲーム状態を捨てて作り直す。

## デバッグ用のフック

| グローバル | 内容 |
| --- | --- |
| `MIKU_GAME.debug()` | スコア・コンボ・進行中の体（お題・髪型・目標角・小節）|
| `MIKU_GAME.galleryDump()` | 完成した全ミクとミク度の内訳 |
| `MIKU_GAME.results()` | リザルト |
| `MIKU_SONG` | ソングアダプタ本体（`rebuild()` / `bar(i)` / `hotSections()` など） |
| `textAlivePlayer` | TextAlive の Player（実曲版のみ） |

## トークンについて

トークンは TextAlive の仕様上クライアントに埋め込む前提のもの（公式サンプルも同様）。
アプリ URL を公開する際は TextAlive for Developers 側のアプリ登録情報を合わせて更新する。

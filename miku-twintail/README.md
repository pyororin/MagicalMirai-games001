# ミクの本体はツインテールである

初音ミク「マジカルミライ」プログラミング・コンテスト応募企画（案）。

黄色いタイヤのホイールに緑のホースを巻き付けるとミクに見える——
「ミクっぽさ」は少数の記号（ツインテール・青緑・シルエット）に宿る、という観察をゲームにします。

**リズムに合わせて、日常のものにツインテールを生やす**ゲームです。
四拍子なら 2 拍目で髪留めをタップし、お題の髪型どおりに伸ばして 4 拍目で髪を生やす。
左右そろうと**ミク度**が判定され、そのミクが背景に並んでいきます。
曲が終わるころには、画面が**ミクだらけ**になっています。

ただの視覚ギャグ（出落ち）で終わらせないための核は 2 つ:

> **1. 譜面は曲そのもの。** 拍・小節・歌詞・尺はすべて TextAlive App API の実データ。
> 曲が変われば譜面も尺も難度も変わる。作り込んだ譜面データは 1 つも持たない。
>
> **2. 「どちら側か」は耳でしか分からない。** 髪留めの合図音は付ける側にステレオ定位する。
> 目で見て打つことはできず、左右を取り違えるとミク度が大きく下がる。

## 遊ぶ（公開デモ）

- **実曲版（本命 / TextAlive 接続）**: https://pyororin.github.io/MagicalMirai-games001/miku-twintail/
  - `?song=0`〜`?song=5` で課題曲を直接指定できます
- **擬似曲版（通信・トークン不要）**: https://pyororin.github.io/MagicalMirai-games001/miku-twintail/mock.html
  - `?bars=8&bpm=100` で尺とテンポを変えられます

遊び方: ▶ スタート → 拍が鳴りはじめたら、**黄色く光る拍**で髪留めをタップし、
そのまま**黄色い破線（お題の髪型）どおりに**指を滑らせる。**桃色の拍**で髪が生えます。
指は離しても離さなくてもかまいません。タップを外すと**ネギ**が生えます。
左右は**音の定位**で示されるのでヘッドホン推奨。

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | 企画・設計書（基本ループ、**ミク度の厳密な定義**、ステージとお題、TextAlive 活用、枯れた技術の水平思考） |
| [docs/MARKET_RESEARCH.md](docs/MARKET_RESEARCH.md) | 市場調査（コンテスト動向・類似作・文化的文脈） |
| [docs/TEXTALIVE_DEV.md](docs/TEXTALIVE_DEV.md) | TextAlive App API 開発ガイド（トークン取得、組み込み、Debugger での確認） |
| [../ontology/textalive.yaml](../ontology/textalive.yaml) | TextAlive / Songle で躓いた点の集約（症状から引ける） |

## 構成 — 擬似曲版と実曲版で同じゲーム本体を使う

```
app/src/game/     ゲーム本体
  stages.js         ステージ 4 種 × お題 24 種（背景と描画）
  score.js          ミク度の定義（純関数。Node からも検証できる）
  hair.js           髪の経路と描画（髪型ごとに角度・長さが変わる）
  audio.js          拍の音・効果音・掛け声（Web Speech）
  core.js           状態機械と描画ループ
app/src/song/     ソングアダプタ（楽曲へ触る唯一の口）
  mock.js           擬似曲（130BPM を自前合成）
  textalive.js      実曲（TextAlive App API）
app/index.html    実曲版      app/mock.html  擬似曲版
prototype/        v1（自由描画版）の参考モック
```

`core.js` は楽曲をアダプタ越しにしか触りません
（契約は `ready / time / atAudio / beat / bar / barIndexAt / onBeat / charAt / vocalAt / ended`）。
モックで詰めた手触りが、そのまま実曲版の手触りになります。

## 開発

```sh
cd miku-twintail/app
npm ci
npm run dev        # http://localhost:5173/           実曲版
                   # http://localhost:5173/mock.html  擬似曲版
npm run build      # dist/ に両ページを出力
```

ホスト接続（TextAlive App Debugger）での確認は [docs/TEXTALIVE_DEV.md](docs/TEXTALIVE_DEV.md) §3 を参照。

## クレジット

楽曲情報・歌詞の解析データは [TextAlive App API](https://developer.textalive.jp/)（産業技術総合研究所）と
[Songle](https://songle.jp/) を利用しています。楽曲の著作権は各権利者に帰属します。
「ミク！」の掛け声はブラウザの音声合成（Web Speech API）によるもので、
**初音ミクの音声素材は使用していません**。

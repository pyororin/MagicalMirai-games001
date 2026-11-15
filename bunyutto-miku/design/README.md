# ミクの顔・表情デザイン

ぶにゅっとミクの顔のデザインは**データファイル**で管理している。ゲーム本体はこのデータを読んで顔を描くので、
**データを変えれば本編に反映される**(コードは触らない)。

| ファイル | 役割 |
|---|---|
| [`../app/data/design/miku-face.json`](../app/data/design/miku-face.json) | **デザインの元データ**(色・形・5つの表情・髪・動き)。これを編集する |
| [`miku-face-sheet.png`](miku-face-sheet.png) | 現在のデザインシート(5表情+コマ送り)。`render-design-sheet.mjs` で生成 |
| [`../app/face-lab.html`](../app/face-lab.html) | デザインラボ。JSON を貼って/編集して、その場でプレビュー |
| [`../app/src/face.js`](../app/src/face.js) | データを読んで描く描画コード(デザインは持たない) |
| [`../tools/render-design-sheet.mjs`](../tools/render-design-sheet.mjs) | デザインシート(PNG)の生成 |
| [`../test/design.test.mjs`](../test/design.test.mjs) | データの検証・本編に反映されることのテスト |

## 変更の流れ

1. `app/face-lab.html` を開く(公開版なら `…/bunyutto-miku/face-lab.html`)。JSON を編集して「プレビュー」。
   別案は `?design=案のURL` を付けて開くと、その案を読み込む(ゲーム本体も `?design=` で同じように試せる)。
2. よければ `app/data/design/miku-face.json` に反映(ラボの「JSON をダウンロード」→ 置き換え)。
3. デザインシートを更新: `node bunyutto-miku/tools/render-design-sheet.mjs`
4. テスト: `node --test bunyutto-miku/test/*.test.mjs`(壊れたデータは場所つきのメッセージで拒否される)
5. ビルド番号を上げてコミット(`app/index.html` の `BUNYU_BUILD` と `app/src/game.js` の `BUILD`)。
   マージして Pages に載ると本編に反映される。

## デザインの原則(可愛さが絶対条件)

- 丸くてシンプルな「ちびミク」。目は小さめ・丸い。口は小さく。ほっぺは「おもち」のように丸く。
- **怖く見える要素は入れない**: 鋭いまつ毛、歯、ぎざぎざの前髪、濃い輪郭線、怒り方向の眉。
- **変形するのは顔(表情・輪郭)だけ**。髪・ツインテール・ヘッドホン・体はピンチで動かない。
- 表情の変化は**連続的**(オン・オフにしない)。目も口も、値を補間して形そのものが変わる。
- 目は**喜ぶ目と、くの字の苦しげな目の2種類だけ**。舌は口の外に出さない。頬は**手を描かず、つままれた/押された跡**で伝える。

## 座標とパラメータ

座標は**論理 80×80**(左上が原点、y は下向き。顔の中心が (40, 42))。実際は 4 倍の 320×320 ドットで描く。
値の多くは「論理座標での長さ」。`palette` 以外はすべて数値。

### `palette` — 色(`#RRGGBB`)
髪 `hair`(本体) `hairD`/`hairDD`(影) `hairL`/`hairLL`(つや)、肌 `skin`/`skinS`(あご下の影)/`skinSS`、`outline`(顔の輪郭線)、
`blush`/`blush2`(頬紅の中心/ふち)、`markPinch`/`markPress`(頬の「つままれた跡」「押された跡」の赤み)、`lipHi`(唇のつや)、目 `ink`(線。目は線だけで描く)、
口 `mouthIn`/`tongue`/`lip`/`lipD`、服 `shirt`/`shirtS`/`sleeve`/`tie`/`tieD`、ヘッドホン `gear`/`gearL`/`gearT`、演出 `spark`/`sweat`。

### `head` — 顔
`cx,cy` 中心 / `rx,ry` ふだんの半径 / `chinTaper` あごの細り / `cheek.{y,height,bulgeOut,bulgeIn}` ほっぺの位置・範囲と、
引っ張る/押さえるときのふくらみ量 / `cheek.puff` 押さえられたとき、押された所の上下がふくらむ量 / `shade` あご下の影のかかり方 / `outlineWidth` 輪郭線の太さ。

### `eyes` — 目(2種類だけ)
目は **喜ぶ目(＾＾の弧)** と **くの字の少し苦しげな目(＞＜)** の2種類だけ。表情ごとに `expressions.*.eye.chev`(0=喜ぶ目、1=くの字)で選び、
途中の値では形が連続して変わる(丸い目玉・ハイライト・まばたきは無い)。
`size` 全体の大きさ / `dx` 左右の距離 / `y` 高さ / `rx` 弧の半幅 / `arc.{bow,yoff}` 喜ぶ目の反りと高さ / `chevron.{tipX,tipY,innerX}` くの字の形 / `line` 線の太さ。

### `cheekMarks` — 頬の跡(手は描かない)
ほっぺがのばされた/押されたときの**跡**で、手の代わりに伝える。強さは表情の `pull` に比例して連続して濃くなる。
`pinch` つままれた跡(い など `pull` が+): 親指と人差し指の赤み2つ+そこから扇状にひろがる引っぱり線 /
`press` 押された跡(う など `pull` が−): 赤くなった頬+押されて寄ったしわ。`y` 高さ、`inset` 頬の縁から内側へのずれ、`strength` 赤みの濃さ。

### `brows` `blush` `mouth`
眉(位置・太さ・傾きの係数)、頬紅(位置・大きさと、表情の `blush` に応じた拡大量)、口の共通設定(最小サイズ・くちびるの太さの基準・舌が現れる大きさ)。

### `hair` — 髪(変形しない)
`back` 後ろ髪の楕円 / `tails.points` ツインテールの通り道(`[根元からの相対x, 相対y, 揺れの係数]`)と、
`shadow`/`body`/`gloss`/`glossHi`/`streaks`(影・本体・つや・筋)、`tie` ヘアゴム /
`fringe` 前髪: `base` 毛先の高さ、`wave` 毛先のまるい波(`amp` 高さ・`period` 周期)、`part` 真ん中のわけ目、`sweep` 左右へ流れる量、
`side` 顔の縁に沿って下りるサイドの髪、`strands` 毛束の筋、`ring` てっぺんの艶(天使の輪)。

### `headphones` `body` `fx`
ヘッドホン(大きさ・位置)、首・肩・ネクタイ(点列。`sleeve` は左側で、右は反転)、マンガ記号 `fx`(`sparkle` きらきら=い、`squeeze` 内向きの線=う、
`sweat` 汗=え、`shout` 声の線=お。`ramp` は現れ始める/満量になる重み)。

### `motion` — 動き
`weightSmoothSec` 指の動きに顔が追いつく速さ(小さいほど機敏) / `beatBounce` `bounceFollow` 拍の弾み /
`sway` ツインテールの揺れ。

### `expressions` — 5つの表情(あ・い・う・え・お)
指を動かした量で、**あ → 各母音へ連続して混ざる**。各母音は次の値を持つ:

| 項目 | 意味 |
|---|---|
| `fw` `fh` | 顔の幅・高さの倍率(1.14 = 14% 広い) |
| `pull` | ほっぺ(+: 外へふくらむ/のばす、−: へこむ/押さえる) |
| `browY` `browTilt` | 眉の上下 / 傾き(+: 内側が下、−: 内側が上=困り眉) |
| `blush` | 頬紅の強さ(0〜1) |
| `eye.size` | 目の大きさ(`eyes.size` に掛かる倍率) |
| `eye.chev` | 目の種類(0 = 喜ぶ目、1 = くの字の苦しげな目。途中は連続) |
| `mouth.w` `mouth.h` `mouth.y` | 口の幅・高さ・中心の高さ |
| `mouth.p` | 上辺の平らさ(0 = 楕円、1 = 上が平らな笑顔) |
| `mouth.n` | 角の立ち(2 = 丸、3 = 四角寄り) |
| `mouth.pad` | くちびるの太さ(大きいほど太く明るい色) |
| `mouth.tg` | 舌の位置・大きさ(口の大きさに対する比 `dy` `rx` `ry`)。**舌は口の内側にだけ描かれ、唇の線から出ない**(`mouth.tongueMargin` が余白) |
| `mouth.wrinkle` `mouth.shine` | 唇の縦じわ(すぼめ口)とつやの強さ(0〜1。形は上の `mouth` セクション) |

表情を足すとき: 母音は 5 つ固定(ゲーム側の対応)なので、新しい「表情」は既存の母音の値を変えて作る。
値は連続的に混ざるので、極端に違う形にすると途中の形が崩れる。必ずラボのコマ送りで途中を確認すること。

## 変更前後の検証

デザインを変えたら、`face-lab.html` のコマ送りで隣のコマ同士が飛んでいないか、5表情が一目で区別できるか、
**怖く見えないか**を最優先で確認する(詳細: `ontology/rhythm-game.yaml` の `pixel-character-cute-first` / `expression-pops-instead-of-morphing`)。

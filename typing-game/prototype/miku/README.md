# miku/ — ミクの見た目と仕草のコンポーネント

ミクのドット絵・表情・ポーズ・仕草はすべて `miku.js` に閉じている。
アプリ(`../textalive.html`)はキャンバスを渡して、口の開き具合と
「いま歌っているか」を伝えるだけ。**見た目を足すときはこのディレクトリだけを触る。**

```
prototype/
├── miku/
│   ├── miku.js      … コンポーネント本体(window.MikuActor)
│   └── README.md    … このファイル
└── textalive.html   … アプリ。<script src="./miku/miku.js"> で読む
```

## 使い方(アプリ側)

```js
MikuActor.init(document.getElementById("miku"));   // 32x40 のキャンバスを渡す

// 毎フレーム
MikuActor.setMouth(m);                             // 0=閉じ 1=半開き 2=開き
MikuActor.tick(performance.now(), {singing:歌詞が鳴っているか, playing:プレイ中か});
ctx.drawImage(MikuActor.canvas(), x, y, w, h);     // 好きな大きさで貼る

// 判定が出たとき
MikuActor.react("JUST"|"GREAT"|"GOOD"|"TYPED"|"LATE"|"MISS");

// 拍で跳ねる高さ(0〜1程度。呼び出し側でドット単位に換算する)
var bounce = MikuActor.bounce(beatPulse, beatNow && beatNow.position, calmMotion);
```

`tick()` が表情の期限切れ・仕草の進行・**間奏での自動仕草**をまとめて面倒を見る。
`singing:false` の状態が続くと、1.2〜3.8 秒おきにランダムな仕草を再生する
(歌が始まる、または判定が出ると中断して通常に戻る)。

## API

| 呼び出し | 役割 |
| --- | --- |
| `init(canvas)` | 32x40 のキャンバスを受け取って初期化 |
| `canvas()` / `size()` | 貼り付け用のキャンバス / 素の大きさ |
| `setMouth(n)` | 口(0〜2) |
| `setExpr(name, ms)` | 表情を指定。`ms` を渡すとその時間で戻る |
| `setPose(name, ms)` | 腕のポーズを指定。同上 |
| `react(grade)` | 判定への反応(ヒット=にっこり+両手、ミス=しょんぼり+うなだれ) |
| `playGesture(name?)` | 仕草を1つ再生(省略でランダム)。名前を返す |
| `gestureNames()` | 仕草の名前一覧 |
| `tick(now, opts)` | 毎フレーム呼ぶ。`opts={singing, playing, idle}` |
| `bounce(pulse, position, calm)` | 拍の跳ね。**1 拍おき(奇数拍)に跳ねる**(build 42 で頻度を倍にした。小節頭だけだと落ち着きすぎた)。揺れも同じ速さ |
| `render()` | 見た目が変わったときだけ描き直す(自前で呼ぶ必要は普通ない) |
| `peek()` | いまの表情・口・ポーズ・仕草(検証用) |
| `reset()` | 通常状態に戻す(プレイ開始時に呼ぶ) |

## 足し方

### 表情を足す
`miku.js` の `EXPRS` に関数を1つ追加する。目もとだけを描けばよい
(顔・髪・体は共通部分が描いてくれる)。

```js
var EXPRS={
  ...,
  surprise:function(){ mp(11,8,3,5,MK.eye); mp(19,8,3,5,MK.eye); }
};
```

### ポーズを足す
`POSES` に関数を1つ追加する。腕だけを描く。引数 `f`(0/1)で2コマの動きが作れる。

```js
var POSES={
  ...,
  point:function(f){ mp(9,19,2,6,MK.shirt2); mp(22,14,2,6,MK.shirt2); mp(22,12,2,2,MK.skin); }
};
```

### 仕草(間奏で出るもの)を足す
`GESTURES` に1行足すだけ。`fps` を 0 にすると静止、入れると2コマで動く。

```js
{name:"point", pose:"point", expr:"ok", ms:1200, fps:4}
```

## 座標のめやす(32x40)

| 部位 | 範囲 |
| --- | --- |
| ツインテール | x 4-8 / 24-28、y 5-30 |
| 頭・顔 | x 8-24、y 2-17 |
| 目 | 左 x 11-14 / 右 x 19-22、y 9-13 |
| 口 | x 14-19、y 13-17 |
| 胴(シャツ) | x 11-21、y 18-25 |
| 腕(ポーズで可変) | x 8-11 / 21-24、y 8-27 |
| スカート〜ブーツ | x 9-23、y 25-39 |

## 決めごと

- **1ドット=1px で描く**。拡大はアプリ側が `drawImage` で行う(`imageSmoothingEnabled=false`)
- スプライトは**変化があったときだけ**描き直す(`expr/mouth/pose/frame` をキーにしている)
- 動きの「大きさ」はここで決め、位置はアプリが決める。跳ねの振幅を変えるなら `bounce()` を触る
- **このファイルを更新したら、この README も同じコミットで更新する**

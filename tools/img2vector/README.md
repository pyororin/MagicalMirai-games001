# img2vector — 画像を「べた塗り+輪郭」のベクター画像に模写する

入力は画像、出力は SVG(と、それを描き直した PNG)。**リポジトリ内の各企画から共通で使う**。
SVG は単色の塗りのパスだけ。**グラデーション・フィルター・透明度・埋め込み画像は使わない**(ツールが検査し、混ざったら失敗する)。
同じ入力と設定なら、毎回同じ SVG になる(乱数を固定)。

> **入力する元絵のルール(必ず守る)**: コンテスト規約により、画像生成 AI(Gemini など)の出力は、完成品にも**元絵(入力)にも使えない**。
> 入力してよいのは、人が描いた絵、コードやデザインデータで描いた図、正規に許諾を得た絵(作者名を明示)だけ。
> 作った素材は `lyric-homerun/art-src/provenance.json` に出どころを書き、`python tools/check_art_provenance.py` で検査する。

## 準備

```powershell
python -m pip install -r tools/img2vector/requirements.txt
```

使うライブラリ: **vtracer**(曲線へのベクター化)、**resvg_py**(SVG の描き直し)、OpenCV(平滑化・k-means・ラベル整理)、
scikit-image(SSIM・CIEDE2000)、Pillow、NumPy。

## 使い方

```powershell
python tools/img2vector/img2vector.py 入力.png -o 出力フォルダ --colors 20
python tools/img2vector/img2vector.py 入力.png -o 出力フォルダ --auto          # 色数を 8〜48 から自動で選ぶ
python tools/img2vector/img2vector.py 人物.jpg -o out --transparent-bg --png-height 600   # 背景を透過、PNG は高さ600
```

出力(`<名前>` は入力名。`--stem` で変更): `<名前>.svg` / `<名前>.png` / `<名前>.quantized.png`(減色後) / `<名前>.report.json`(SSIM・色差・色数・パス数・パレット・設定)。

| オプション | 意味 |
| --- | --- |
| `--colors N` / `--auto` | 減色後の色数 / 自動選択(最高 SSIM から 0.004 以内で、パス数が最小のもの) |
| `--upscale X` | 先に拡大する倍率(既定 2.0)。大きいほど細かいが遅い。大きな絵は 0.5〜1.0 |
| `--smooth N` | 色をならす強さ(既定 2)。0 で無し |
| `--merge-delta D` | この色差(CIEDE2000)より近い色を統合(既定 6) |
| `--min-area A` | これより小さい島・穴を消す(既定 12) |
| `--corner` / `--length` | 角とみなす角度 / パスの最小区間(vtracer) |
| `--transparent-bg` | 四隅の色の背景を透過にし、透過の余白を切り詰める(足元が下端になる) |
| `--clear-at "x,y;x,y"` | 縁につながらない背景色の隙間(腕と体のあいだ等)を透過にする。元画像の座標 |
| `--warp-y "元:後,..."` | 縦方向だけを伸び縮み(高さの比 0〜1)。球場のホームを 0.59→0.70 に動かすなど |
| `--sketch A` | **手書き風**のゆらぎ(うねり+ペンの震え+色ごとの版ずれ)。A は元画像 px での大きさ。表示が元の 1/3〜1/10 に縮むなら 6〜9 が目安。0 で無し |
| `--sketch-wave W` / `--sketch-seed N` / `--misregister M` | ゆらぎの波長(px) / 乱数の種(同じ種なら同じ絵) / 版ずれ(px) |
| `--verify-edge-f1` / `--verify-iou` | **形の確認**の基準(輪郭の一致度 0.80 / シルエット IoU 0.96)。届かなければゆらぎを 0.7 倍にして最大6回作り直す |
| `--flip-x` | 先に左右反転する(例: 左打ちの構えを右打ちにする) |
| `--inpaint-red "x0,y0,x1,y1"` | 反転後の座標の箱の中の赤い文字・印を消す(反転で読めなくなる数字など) |
| `--png-height H` | PNG を高さ H で SVG から描き直す(ベクターなのでどの大きさでも劣化しない) |

## 手書き風と「似た形」の確認

元絵を完璧にトレースするのでなく、**元と似た形のまま、手で描いたゆらぎを足す**(方針B)。
形の確認は、実際に見る大きさ(長辺 640px 程度)に縮めて、次の3つで行う: 輪郭の一致度(Canny の輪郭が 3px 以内で重なる割合の F 値)、
輪郭のずれ(chamfer)、透過の絵のシルエット IoU。基準に届かなければゆらぎを弱めて繰り返す。結果は `report.json` の `verify` に残る。
単体テストは、種(5通り)と強さ(3通り)を変えて繰り返し、「形が保たれる」「素の模写とは違う」「同じ種なら同じ」「基準が厳しいと弱める」を確認する。

## 精度の目安と限界

- 出力は **減色したべた塗り**なので、元の細かいグラデーションや筆のかすれは再現しない。SSIM 0.93〜0.99、平均色差 2〜4 程度。
- 色数を増やすと近づくが、パス数と SVG が大きくなる(その分遅い)。`--auto` で折り合いを探せる。
- 速さ: 1400×3000 の絵で数分かかる(画素をリストにして vtracer に渡すため)。`--upscale 0.5〜1.0` と `--transparent-bg` の切り詰めで短くなる。
- **元絵の扱い**: このツールは、渡された画像の見た目を写すだけ。元絵の出どころ(AI 生成・公式イラストなど)で規約上の扱いは変わる。
  方針は `docs/ai-art-policy.md`。公式イラストはリポジトリに取り込まない(`bunyutto-miku/design/README.md`)。

## 他のコードから使う

```python
import sys; sys.path.insert(0, "tools/img2vector")
import img2vector as m
res = m.trace_image(m.load_rgba("in.png"), m.TraceOptions(colors=20, transparent_bg=True))
res.svg, res.png, res.report          # SVG 文字列 / PNG バイト列 / 精度
```

## テスト

```powershell
python -m unittest discover -s tools/img2vector -v
```

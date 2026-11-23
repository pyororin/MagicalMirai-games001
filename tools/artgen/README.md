# artgen — デザインデータ(JSON)から、元絵をコードで描く

**画像生成 AI は使わない**。形・色・位置はすべて、デザインデータ(JSON)に書く。
ここで描くのは「元絵」で、`tools/img2vector` が、べた塗り+手書き風のゆらぎを足して、ゲームで使う素材にする。
一括は `build_art.py`(下の「素材を作る」)。

```
lyric-homerun/art-src/design/*.json   デザインデータ(これを編集する)
        │  artgen.py     元絵(SVG・高解像度 PNG)
        ▼
        │  img2vector    べた塗り + 手書き風 + 「似た形か」の確認
        ▼
lyric-homerun/app/assets/*.png         ゲームで使う素材(出どころ = program)
```

## デザインデータの書き方

```json
{
  "name": "batter", "size": [420, 600],      // 作業キャンバス(px)。PNG は --scale 倍で出す
  "bg": "#FFFFFF", "outline": "#5E4033", "w": 4,
  "colors": {"hair": "#6EC3C0"},             // 名前付きの色。図形では "$hair"
  "shapes": [                                // 奥から手前の順に描く
    {"t": "path", "d": "M10 10 C ... Z", "fill": "$hair"},
    {"t": "ellipse", "cx": 100, "cy": 80, "rx": 30, "ry": 20, "rot": -10, "fill": "#fff"},
    {"t": "rrect", "x": 10, "y": 10, "w": 40, "h": 60, "r": 12, "fill": "#eee", "lw": 3},
    {"t": "poly", "pts": [[0,0],[10,0],[5,9]], "fill": "#f00"},
    {"t": "line", "pts": [[0,0],[50,40]], "stroke": "#000", "w": 6},
    {"t": "group", "tx": 10, "ty": 20, "rot": 15, "shapes": [ ... ]}
  ]
}
```

- 輪郭の太さは `w`(`rrect` だけ `lw`。`w` は幅のため)。0 で輪郭なし。`"fill": "none"` で塗りなし。`_` キーはコメント。
- **同じキーを2回書かない**(テストが検出する)。
- 腕や線に輪郭を付けたいときは、輪郭の色で太い `line` を描き、その上に細い `line` で塗る(関節が丸くつながる)。

- **陰影**: 図形に `"shade": {"c": "$hairD", "dx": -6, "dy": -5}`(影)や `"hl": {...}`(ハイライト)を書くと、形から、ずらした同じ形を引いた
  「三日月」だけがその色で塗られる(光が左上なら、影は dx, dy を負に、ハイライトは正に)。グラデーションは使わない。
- **線の強弱**: 設計の最上位に `"ink": [1.2, 1.6]` を書くと、輪郭の太さが右下の側だけ少し増える。

## 素材を作る

```powershell
python tools/artgen/build_art.py                  # 背景・ミク・MEIKO の下書きを lyric-homerun/art-src/build/ に作る(案シート sheet.png つき)
python tools/artgen/build_art.py --only batter    # 1枚だけ
python tools/artgen/build_art.py --install        # ゲームに入れる(案を見せて承認を得てから)
```

build_art は、再現度の基準(SSIM 0.90・ΔE 3.0・輪郭一致 0.92・IoU 0.98。表示サイズで元絵に対して測る)を満たすまで、
色数・平滑化・ゆらぎを変えて最大5回作り直す(毎回の結果は `*.attempts.json`)。

`--install` は、`app/assets/*.png` と `art-src/*.svg` を置き、`art.json` の `batterHand`(拳の位置)と
`provenance.json`(出どころ=`program`)を更新する。そのあと `python tools/check_art_provenance.py` が通ること。

## バランス検査(デッサンの基本)

絵が整っているかを、**測って**確かめる。根拠と数値は `docs/character-design-basics.md`(調査と出典)。

```powershell
python tools/artgen/proportion_check.py --all                                   # batter と pitcher を検査(不合格なら終了コード 1)
python tools/artgen/proportion_check.py lyric-homerun/art-src/design/batter.json
```

- デザインデータに `style`(種類 stylized/chibi、向き side/front、頭身の幅、構え stance)と `landmarks`(絵の上の目印)を書く。
- P1 頭身 / P2 目の高さ / P3 肩幅・胴の厚み / P4 脚の長さ / P5 膝 / P6 腕・こぶし / P7 足 / P8 脚の左右 / P9 重心 / P10 髪の量 /
  P11 目印が絵と合っているか / P12 膝の曲げ / P13 胴の傾き / P14 頭の位置。
- **`build_art.py` は、この検査に通らない絵を作らない。** 例外(`skip` / `override`)は、`style.why` に理由を書く。
- 先細りの手足は `{"t": "limb", "pts": [...], "widths": [...]}`。検査用に髪などを除くには、図形に `"part": "hair_tail"` と書く。

## テスト

```powershell
python -m unittest discover -s tools/artgen -v
```

形・色の描画、`limb`、バランス検査(実際の絵が全部通ること、わざと崩した絵 — 頭が大きい・脚が長い・棒立ち・重心が外れる・嘘の目印 — を見つけること)、デザインデータの重複キー、背景のマウンド 40%・ホーム 70%、スタンドの高さ(観客の段と合う)、
ミクが右打ち(拳が体の右)で「01」が無いこと、口が極小の細い線であること、を確かめる。

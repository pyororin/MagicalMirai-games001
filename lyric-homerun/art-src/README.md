# 絵の素材

**元絵はコードで描く**(AI 不使用)。`design/*.json`(デザインデータ)→ `tools/artgen` が元絵を描く → `tools/img2vector` が
べた塗り+手書き風にして、ここの SVG と `app/assets/*.png` になる。一括は `python tools/artgen/build_art.py`
(下書きは `build/` に出る。案シートを見せて承認を得てから `--install` でゲームに入れる)。

| 素材 | デザインデータ | ゲームの画像 | 内容 |
| --- | --- | --- | --- |
| `background.svg` | `design/background.json` | `app/assets/bg.png` | 球場の背景(ライブ会場風)。マウンド=上から40%、ホーム=70% |
| `batter.svg` | `design/batter.json` | `app/assets/miku.png` | 打者ミク(**右打ち**)。拳の位置は `app/data/art.json` の `batterHand` |
| `pitcher.svg` | `design/pitcher.json` | `app/assets/pitcher.png` | 投手 MEIKO |

**水準**: 高校生が上手に描いたイラストくらい。線はなめらかで、手書きらしさは控えめ(ゆらぎ 2.5〜3px、画面で 0.5px 前後)。
陰影(アニメ塗りの影・ハイライト)と線の太さの強弱を入れる。**強いゆらぎは下手な絵に見える**ので使わない。
**バランス**: キャラクターは `proportion_check.py` の検査(頭身・目の高さ・肩幅・脚・膝・腕・足・重心・構えの安定)に通ること。ミクは右打ちの構え(膝を曲げ、胴を前へ傾ける)。
**再現度の基準**(表示サイズで元絵に対して): SSIM 0.90 / ΔE 3.0 以下 / 輪郭一致 0.92 / シルエット IoU 0.98。
`build_art.py` は、満たすまで色数・平滑化・ゆらぎを変えて作り直し、毎回の結果を `*.attempts.json` に残す。作ったら元絵と並べて目でも見る。

出どころは `provenance.json`(すべて `program`)。`python tools/check_art_provenance.py` が通ること。
`*.report.json` に、手書き風の強さと「形が似ているか」の確認結果(`verify`)が残る。`build/` は下書きで git に入れない。

**過去の履歴**: build 2・3 のコミットには、Gemini の生成画像を元絵にした旧素材が入っている。ルール違反なので、
build 4 で置き換えた。応募用には使わない(`docs/ai-art-policy.md`)。

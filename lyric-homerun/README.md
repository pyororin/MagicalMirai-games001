# とどけ!リリックホームラン(仮)

飛んでくる「歌詞」を、ミクがネギで打ち返して会場のスタンドへ届けるリリックアプリ(打つ=歌う)。
骨子は「くまのプーさんのホームランダービー!」(調査: `../docs/research/pooh-home-run-derby.md`)。

- 設計: [docs/DESIGN.md](docs/DESIGN.md)
- 全企画共通の大方針: [../docs/PRINCIPLES.md](../docs/PRINCIPLES.md)
- 状態: **MVP**(build 1)。ストレートのみ・タイミング判定のみ・絵はコードで描いた仮のもの

## 動かす

```bash
cd lyric-homerun/app && python3 -m http.server 8000
```

- `http://localhost:8000/` … 実楽曲(TextAlive 接続)
- `http://localhost:8000/?demo=1` … デモ(TextAlive 無し。実データの拍と歌詞+合成伴奏)
- `?debug=1` … ずれを ms で表示 / `?auto=30` … 自動で振る(検証用。値はわざとずらす ms)

## テスト

```bash
node --test lyric-homerun/test/*.test.mjs
```

## MVP に入っているもの / いないもの

| 入っている | まだ無い |
| --- | --- |
| 投球生成(EASY/NORMAL/HARD、6曲で球数を固定するテスト) | 球種(コース・ため球・ゆらぎ球・消える球) |
| タイミング判定(特大/ホームラン/ヒット/空振り/見逃し) | 横位置(コース)の操作 |
| 早い→左、遅い→右に飛ぶ。届いた歌詞が空に残る | ボルテージ、アンコール、結果の1枚絵の保存 |
| ノルマ、結果(振りの傾向と補正の提案) | 本番の絵(ミク・投手・背景)、ビジョンの顔 |
| 掲示板(投げられる文字だけ色付き)、拍の輪、効果音 | TextAlive ホスト接続時の実機確認 |
| ビルド番号、通信失敗の診断、クレジット | TextAlive App 利用規約の表示(原文確認後) |

絵の差し替えは `app/assets/README.md`。

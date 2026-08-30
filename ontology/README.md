# Ontology — API・インフラの知見集約

このリポジトリの各企画（セッション）で実際に躓き、解決した知見を構造化して集約する。
**新しいセッション・別アプリの開発を始めるときは、まずこのディレクトリを読むこと**（ルートの CLAUDE.md からも参照される）。

## ファイル構成

| ファイル | ドメイン |
| --- | --- |
| [textalive.yaml](textalive.yaml) | TextAlive App API / Songle（楽曲・歌詞・音源まわり） |
| [infra.yaml](infra.yaml) | GitHub Pages / Actions / Claude Code リモート環境（sandbox） |

## スキーマ

各 YAML は次の 2 種のエントリを持つ:

```yaml
concepts:        # ドメインの構造知識（何が何に依存するか）
  - id: <一意なID>
    what: <概念の説明>
    depends_on: [<依存する概念ID>]

pitfalls:        # 躓きの事例（症状から引く）
  - id: <一意なID>
    symptom: <観測される症状>
    cause: <根本原因>
    solution: <確立した対処>
    detection: <切り分け・診断方法>
    verified: <検証した日付とセッション>
    refs: [<関連ファイルやURL>]
```

## 運用ルール

- 新しく躓いて解決したら、その場でエントリを追加する（解決していない仮説は書かない）
- `verified` に検証日と企画名を残す。API 仕様は変わるので、古いエントリに矛盾する挙動を見たら上書きせず `superseded_by` で新エントリを指す
- 企画固有の話は各企画の docs/ へ、**2 企画目以降でも役立つものだけ**をここへ

# TextAlive App API 開発ガイド

コンテスト応募条件である TextAlive App API（産総研）を、本企画の開発でどう使うかの調査結果。
npm パッケージ `textalive-app-api` v0.5.2 の同梱ドキュメント・型定義（`dist/textalive-app-api.d.ts`）で仕様を確認済み（2026-08-30）。

## 1. 開発を始めるまでの手順

1. **開発者登録とアプリトークン取得**
   [TextAlive for Developers](https://developer.textalive.jp/) で開発者登録し、アプリを登録して
   **アプリトークン**を発行する。`Player` クラスの利用に必須。
   トークンはクライアントサイドに埋め込む前提のものだが、登録時にアプリの URL を正しく設定し、
   ソース上はビルド時の環境変数（Vite なら `import.meta.env.VITE_TA_TOKEN`）経由にしておく。
2. **パッケージ導入**（2 通り。本企画は npm ＋ Vite を採用）
   ```sh
   npm install textalive-app-api
   ```
   ```js
   import { Player } from "textalive-app-api";
   ```
   `script` タグ読み込みの場合はグローバル変数 `TextAliveApp` から `const { Player } = TextAliveApp;`。

## 2. 最小の組み込みコード（本企画向け設定込み）

```js
import { Player } from "textalive-app-api";

const player = new Player({
  app: { token: import.meta.env.VITE_TA_TOKEN },
  mediaElement: document.querySelector("#media"),  // 楽曲プレイヤーの埋め込み先
  vocalAmplitudeEnabled: true,   // 髪の揺れ＝ボーカル音量に必須
  valenceArousalEnabled: true,   // お題抽選＝感情値に必須
});

player.addListener({
  onAppReady(app) {
    // ホスト（Debugger や審査環境）から曲が指定されなければ、開発用の曲を自分で読み込む
    if (!app.songUrl) {
      player.createFromSongUrl("https://piapro.jp/t/xxxx", {
        video: { beatId, chordId, repetitiveSegmentId, lyricId, lyricDiffId }, // 課題曲ごとに公表される版数
      });
    }
    // ホスト接続時は再生 UI をホストに任せ、未接続時のみ自前の再生ボタンを出す
    if (!app.managed) showOwnController();
  },
  onVideoReady(video) {
    // 歌詞は video.firstPhrase から Phrase → Word → Char のツリーで辿れる
  },
  onTimeUpdate(position) {
    // 毎フレームの描画駆動。ここから各種データを引く:
    //   player.video.findChar(position)         → いま発声中の文字（髪素材の射出）
    //   player.findBeat(position)               → 拍（ストローク定着判定）
    //   player.findChorus(position)             → サビ区間（ミク度判定の発火）
    //   player.findChord(position)              → コード（髪の色調）
    //   player.getVocalAmplitude(position)      → ボーカル音量（髪の風力）
    //   player.getValenceArousal(position)      → 感情値（お題抽選・背景）
  },
  onPlay() {}, onPause() {}, onStop() {},
});
```

要点（型定義で確認した仕様）:

- `app.songUrl` はクエリパラメタまたはホストからの指定で埋まる。**指定があるときに
  `createFromSongUrl` を自分で呼んではいけない**（自動読み込みされ、ホストが曲を差し替えると
  `onAppMediaChange` が来る）。課題曲をハードコードしない構造が応募要件的にも正しい。
- `app.managed` が `true` ならホスト接続中。再生・シーク UI はホスト側にあるので出さない。
- `vocalAmplitudeEnabled` / `valenceArousalEnabled` は **Player 初期化時に有効化しないと
  `getVocalAmplitude()` / `getValenceArousal()` が使えない**。
- 課題曲は例年、piapro の楽曲 URL ＋ 歌詞・ビート等の**版数 ID（`beatId` / `chordId` /
  `repetitiveSegmentId` / `lyricId` / `lyricDiffId`）**のセットでコンテストページに公表される。
  版数を固定すると全応募者・審査員が同じ解析データで動く。

## 3. 開発中の動作確認フロー

ローカル開発は「ホスト未接続」、審査・展示は「ホスト接続」で挙動が変わるため、両方を回す。

| 状態 | 方法 | 確認すること |
| --- | --- | --- |
| ホスト未接続（普段の開発） | `npm run dev`（Vite で localhost 起動）。`onAppReady` で開発用の曲を読み込み、自前の再生ボタンで動かす | ゲームループ、髪の描画・採点 |
| ホスト接続（応募時の動作） | [TextAlive App Debugger](https://developer.textalive.jp/app/) に自アプリの URL（localhost 可）を入力して接続 | ホストからの**再生・一時停止・シーク・曲変更**への追従、`app.managed` 時に UI が消えること、無操作の観賞モード |

Debugger（ホスト）が曲やシーク位置をアプリに指示してくるので、
**内部状態を「定着済みストローク＋定着時刻」だけにして `position` 起点の純関数で描く**
（DESIGN.md §7）設計がここで効く。シークで時刻が飛んでも矛盾しない。

公式サンプル（[TextAliveJp の GitHub](https://github.com/TextAliveJp)）では
[textalive-app-basic](https://github.com/TextAliveJp/textalive-app-basic)（発声中テキスト表示＋ホスト有無で
再生コントロール切替）が最小の手本。ほかに歌詞カード、パラメタ調整（React）等の作例がある。

## 4. モックからの移行対応表

`prototype/index.html` の擬似データ層は、次の対応でそのまま置き換わる:

| モックの擬似層 | 置き換え先 |
| --- | --- |
| `BPM` / `onBeat(t)` | `player.findBeat(position)`（`beat.progress(position)` で拍内位相も取れる） |
| `vocalActive(t)` / `vocalAmp(t)` | `player.getVocalAmplitude(position)`（正規化は曲中最大値 `getMaxVocalAmplitude()` で） |
| `LYRICS` 固定文字列 | `video.findChar(position)` で発声中の文字を射出 |
| WebAudio 擬似曲 | `mediaElement` 経由の楽曲再生（自前の音源は不要になる） |
| 手動「お題交換」 | 楽曲セクション（サビ検出 `findChorus` ＋区間情報）で自動交換 |
| 「ミク度判定」ボタン | サビ突入イベントで自動発火 |

## 4.5 楽曲利用（実装済み）

- **選曲**: `SONGS` 配列に課題曲を版数 ID 付きで持ち、`createFromSongUrl` を呼び直して切り替える。
  「他の曲を URL で指定」では版数 ID を省略し、最新の解析結果で読み込む。
- **切替時の後始末**: 曲に紐づくゲーム状態（描いた髪・採点結果）を捨て、`ready` を false に戻す。
  ホストが曲を差し替える場合も同じ処理が必要なので `onAppMediaChange` でも行う。
- **UI の出し分け**: 選曲 UI は `app.managed === false`（ホスト未接続）のときだけ表示する。
  ホスト接続時は曲の主導権がホスト側にあるため。
- **クレジット**: TextAlive App API（産総研）と Songle の利用、および楽曲の著作権が
  各権利者に帰属することを画面に明示する（ライセンス要件）。

## 4.6 拍を譜面として使う（本企画の実装）

- 拍の全列は **`player.data.getBeats()`** で取る。`player.data.beats`（プロパティ）は
  空のままのことがある（`ontology/textalive.yaml` の `player-data-beats-is-empty`）。
- `IBeat.position === 1` を境目に小節へ束ねる。`IBeat.length` が小節の拍数。
- **課題曲は四拍子とは限らない**（2025 年は「ロンリーラン」が 6 拍子）。
  拍数を数えず「小節の最後の拍」「その 2 拍前」で譜面を定義すると、
  どの拍子でも操作区間が 2 拍に保たれる
  （`ontology/textalive.yaml` の `contest-songs-are-not-all-4-4`）。
- 効果音を Web Audio で拍に重ねるときは、曲時刻 → AudioContext 時刻の換算を
  `ac.currentTime + (曲時刻 − player.timer.position/1000)` で毎回取り直す。
  先読みは 0.3 秒以内に収めればドリフトは気にならない。

## 5. 応募時の注意（例年の要件から）

- アプリは URL で公開して応募する（GitHub Pages / Netlify 等）。ソースコード公開も例年求められる。
- 課題曲すべてで動作すること。曲はホストから差し替えられるため、曲名・歌詞・尺への
  ハードコードを持たない（§2 の構造なら自然に満たせる）。
- 無操作でも楽曲同期演出として成立すること（観賞モード、DESIGN.md §7）。
- 募集要項は年度ごとに更新されるため、2027 年大会の要項公開時に本ガイドを照合・更新する。

## Sources

- [TextAlive for Developers](https://developer.textalive.jp/)（開発者登録・チュートリアル・App Debugger）
- [textalive-app-api（npm）](https://www.npmjs.com/package/textalive-app-api) v0.5.2 同梱 README と型定義
- [textalive-app-api（GitHub）](https://github.com/TextAliveJp/textalive-app-api)
- [textalive-app-basic（公式最小サンプル）](https://github.com/TextAliveJp/textalive-app-basic)
- [Player API リファレンス](https://developer.textalive.jp/packages/textalive-app-api/classes/Player.html)

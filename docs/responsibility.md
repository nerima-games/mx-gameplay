# 責務と非スコープ

## 1. 責務（plan.md §3.11）

> **責務**: 体験ルールの束: 採掘/設置/アイテム使用（バケツ・火打石・エンダーパール・弓・農業・ハサミ等）、
> Mob AI（クリーパー起爆・エンダーマンテレポート・シュルカー・ドラゴン等）、ドロップ/ルートテーブル、
> 流体伝播、乗り物（ボート/トロッコ/レール）、ポータル/次元移動ルール、昼夜・天候

7 つの束はすべて**動詞**である。共通しているのは「世界の事実を読み、条件を判定し、世界の事実を書き換える」形で、
事実そのものを保持するものが 1 つも無い。これが体験モジュールの定義である（[architecture.md](./architecture.md) §3）。

## 2. plan.md §7 カバレッジ表で、ここに割り当てられている行

plan.md §7 は「Minecraft クローンの全機能が 16 リポジトリで表現できるか」の総当たり監査である。
その表のうち `gameplay` が現れる行を全部書き出すと以下になる。

| 機能領域 | 割り当て先 | mx-gameplay の取り分 |
| --- | --- | --- |
| 次元（ネザー/エンド、次元別地形・Mob 名簿・次元永続化） | worldgen + sim + gameplay + save | **次元移動のルール**（ポータル成立条件・遷移の発火） |
| 乗り物（ボート/トロッコ/パワードレール）のルール | **gameplay** | 全部 |
| Mob（状態管理は sim、AI/スポーン/ドロップのルールは gameplay） | sim + gameplay | **AI・スポーン条件・ドロップ** |
| 戦闘・体力・空腹・XP | sim（状態）+ gameplay（ルール） | **ダメージの発生条件と量、空腹の減り方** |
| 流体・農業・ベッド/睡眠・天候・昼夜 | **gameplay** | 全部 |

「割り当て先」が単独で `gameplay` なのは 2 行だけで、残り 3 行は他リポジトリとの分担である。
分担の境界はすべて**名詞/動詞の線**に一致している — 状態が向こう、ルールがこちら。
表を読むときに毎回この対応を思い出せるよう、右列を足してある。

## 3. 明示的な非スコープ

**ここに書きたくなるが、ここではないもの。** 行き先つきで列挙する。
行き先が分からないまま「とりあえずここ」に置かれたものが、参照実装で合成層に 13k LOC 溜まった中身である。

| 非スコープ | 実際の置き場 | なぜ |
| --- | --- | --- |
| エンティティ / インベントリ / 体力 / XP / 時刻の**状態** | `mc-sim` | 名詞。セーブファイルに要る |
| 地形生成・構造物生成・チャンクのライフサイクル | `mc-worldgen` | 名詞。`generateChunk` は決定論的な純関数で、ルールではない |
| オーディオエンジン・効果音キューレジストリ・BGM 状態機械 | `mc-audio` | 名詞。`mx-gameplay` は `SoundCuePort.play(cueId)` を**呼ぶ**だけ |
| レッドストーン（ワイヤ電力伝播・ピストン・リピーター） | `mx-redstone` | 兄弟の体験モジュール。自己完結しており分離済み（plan.md §5.3） |
| **すべての画面**（HUD / メニュー / インベントリ UI / 設定）、**死亡画面を含む** | `mx-ui` | 兄弟。死因は `mx-gameplay` の事実だが、文章と描画は `mx-ui` の仕事 |
| stage の**全順序**と Layer 配線 | `mc-compose` | ここは制約（`after`）を宣言するだけ（plan.md §2.3-3） |
| ブロック能力フラグ・ブランデッド型・座標系・契約型 | `mc-kernel` | 共有語彙。`fallsWhenUnsupported` は kernel、「落ちる」は here |
| 衝突判定・レイキャスト（voxel-DDA） | `mc-physics`（`mc-sim` 経由） | 推移閉包禁止。`mc-physics` を直接 import はできない（[architecture.md](./architecture.md) §5） |
| 実行時入力（キーボード / マウス / ポインタロック） | `mc-render` | plan.md §2.3-2。kit に置くと出荷ゲームから入力が消える |
| E2E・QA/デバッグ API・Modding 入口 | `mc-compose` | 体験モジュール間の相互作用はそこでしか検証できない |

### 3-1. 死亡画面という境界の実例

`domain/death-cause.ts` は `DEATH_MESSAGES`（英語の文字列表）を持っている。これは一見 §3 の表と矛盾する。

矛盾ではない。**死因は事実であり、文章は表現である。** 現在は表現の受け皿（`mx-ui` の死亡画面）が存在しないので、
参照実装の `packages/entity/domain/player-damage-cause.ts:31` と同じ位置 — ルールを所有するモジュール — に置いてある。
ローカライズが来た時点で `mx-gameplay` は `DeathCause` を発行するだけになり、文字列解決は `mx-ui` へ移る。

先に i18n 契約を発明しないのは、消費する画面が無いうちに界面を決めても当たらないからである。
この判断は `domain/death-cause.ts` のファイルコメントにも書いてある。

## 4. 親リポジトリ

| 親 | 何を借りるか |
| --- | --- |
| `mc-sim` | エンティティ / インベントリ / 体力 / XP / 時刻 の読み書き。**最重要の界面**（plan.md §3.8）。**チャンクダーティ通知はここではない** — `mc-worldgen` の `ChunkStore`（`domain/chunk-store-port.ts` のヘッダ参照） |
| `mc-worldgen` | ブロックの読み書き、チャンクのロード状態 |
| `mc-audio` | `SoundCuePort.play(cueId, options)`。字幕イベントは audio が発行し `mx-ui` が購読する |
| `mc-kernel` | 共有語彙（全リポジトリ共通。許可リストに書かずに import 可） |
| `mc-playground-kit` | **devDependency のみ。** プレビュー 3 本の起動ハーネス |

> **現状**: この表は**意図された最終形**であって、現在の `package.json` の内容ではない。
> `dependencies` は `effect` のみで、`@nerima-games/*` は 1 つも宣言されていない
> （どれもまだ publish されていないため。plan.md §6 Step 3 の bottom-up publish-then-pin）。
> `mc-playground-kit` を `devDependencies` に書くのは、kit が publish され、
> かつこのリポジトリに `apps/preview-*/` を作るときである（現在プレビューは 1 本も存在しない）。
> 依存グラフの権威は `package.json` ではなく
> `scripts/check-dependency-whitelist.ts` の roster であり、そちらは今日から実在する。

### 4-1. kit が devDependency **だけ**である理由（plan.md §2.3-2）

kit は出荷されない。**実行時入力サービスは `mc-render` が所有する。**
もし入力が kit にあると、あるいは `mx-gameplay` が kit を実行時依存に持つと、
出荷ビルドから入力処理が丸ごと消える。プレビューでは動き、本番だけ動かない — 最も見つけにくい壊れ方である。

だからゲートは 2 箇所で落とす（`dependencies` への混入と、出荷ソースからの import）。
エラーメッセージは両方とも "delete input handling from the shipped game" を含んでおり、
テストがその文字列自体を assert している
（`REGRESSION: kit in "dependencies" is an error, because it would delete input handling from the shipped game`）。

## 5. このリポジトリを分割しない

plan.md §3.11 と §5.3 の確定事項である。

> このリポジトリは変更頻度が最も高くなる（参照実装で 200 commits/3ヶ月）。
> **さらなる分割（採掘/農業/戦闘の個別リポジトリ化）はしない** —
> 共通の stage 契約を共変更する一枚岩であり、狭い界面が存在しない

分割の是非を決めるのは規模ではなく**界面の狭さ**である。3 点。

1. **共通の stage 契約を共変更する。** 採掘も農業も戦闘も、同じ `gameplay:interactions` に登録され、
   同じ `FrameServices` を読み、同じ `after` 制約の下で走る。契約が動けば全部が動く。
   「採掘リポジトリ」と「農業リポジトリ」に切っても、変更は常に両方に入る。
2. **狭い界面が存在しない。** `mx-redstone` は電力グラフという自己完結した内部を持ち、公開するのは stage 登録だけなので
   分離できた（plan.md §3.12）。採掘と農業の間にそういう境界は無い — 両方とも
   「ブロックを読み、条件を見て、ブロックとインベントリを書く」であり、切る場所が無い。
3. **40 ファイルはファイルの粒度である。** plan.md §2.4 の 3 単位を混同してはいけない。
   参照実装の `interaction-*.ts` は非テストで実測 40 ファイル / 3,317 LOC（[porting.md](./porting.md)）だが、
   これは 1 ルール 1 ファイルの結果であって、リポジトリを 40 個にする理由にはならない。
   **多数のファイルと、1 つの stage 登録**が正しい形である（[public-api.md](./public-api.md) §4）。

分割しないと決めた以上、境界の維持はゲートに任せるしかない。
`test/check-dependency-whitelist.test.ts` の冒頭が書いているとおり、
「変更が絶えず、分割が禁じられているリポジトリ」は、まさに持ってはいけない import が生えるリポジトリである。

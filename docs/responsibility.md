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

## 5. 乗り物（plan.md §3.11 の 5 番目）—— レールの記号ごとの行き先

**この節が、乗り物の記号ごとの所有権を書いている唯一の場所である。**
[testing.md](./testing.md) §3-1 / §3-2 はここを指すだけで、結論を書き直さない。
同じ判断が 2 か所に書かれると 2 か所が食い違うのは、testing.md §3-1 の見出しが
記録しているとおり、このリポジトリで実際に起きた失敗である。

### 5-1. 1 ファイルに関心が 2 つ入っていた

参照実装の `packages/game/domain/rail-shape.ts` は 82 行の 1 ファイルだが、中身は 2 種類ある。
`mc-meshing/docs/responsibility.md` §3.4 が `lod-simplification.ts` を
「**距離を取るか**」で割ったのと同じ形なので、同じやり方で割る。
こちらの決め手は **速度の「大きさ」が答えに届くか** である。

| 記号 | 引数 → 戻り値 | 速度の大きさが答えに届くか | 行き先 |
| --- | --- | :-: | --- |
| `RailShape` / `IsRailAt` | 語彙 | 速度が出てこない | **mx-gameplay**。`domain/vehicle/rail-shape.ts`（**実装済み**） |
| `resolveRailShape` | `(IsRailAt, wx, wy, wz)` → `RailShape` | **取らない** | **mx-gameplay**。同上（**実装済み**） |
| `isAscendingAhead` | `(IsRailAt, wx, wy, wz, headingX, headingZ)` → `boolean` | **取るが、届かない** | **mx-gameplay**。`domain/vehicle/rail-ascent.ts`（**実装済み**） |
| `projectMinecartVelocity` | `(RailShape, vx, vz)` → `{vx, vz}` | **届く**（`Math.hypot` で速さを保存して向け直す） | **mx-gameplay**。ただし §5-3 により**まだ書かない** |
| `RAIL_CLIMB_SPEED = 3.5` | 定数（blocks/秒） | 速度そのもの | **mx-gameplay**。ただし §5-4 により**運ばない** |

`isAscendingAhead` がこの表で唯一むずかしい行である。速度の形をした引数を取るのに、
使い道は `Math.sign` と 1 回の大小比較だけで、**大きさは 1 行目で捨てられて答えに届かない** ——
正の定数を掛けても同じセルを調べる。だから引数は速度ではなく**向き**であり、
返るのは `isRailAt` の結果そのもの、すなわちブロックについての事実である。

**この行だけは散文ではなくテストが押さえている。**
`test/rail.test.ts` の
`scaling a heading by any positive factor cannot change the answer` が、
同じレール世界を複数の正の倍率で走らせて答えが 1 つであることを要求する。
「坂に乗るには最低速度が要る」という項をあとで足すと、そのテストが赤くなり、
**コードが入る前にこの表の行を書き直す必要が出る。** それがこの書き方の目的である。

### 5-2. mc-physics は 1 つも取らない —— 根拠は mc-physics 自身の文書である

「速度を出す側は mc-physics」という切り方は、**この 5 記号のどれにも当たらない。**
3 つ理由があり、いずれも既存の文書に書いてある。

1. **mc-physics が明示的に断っている。** `mc-physics/docs/responsibility.md` §3
   「明示的にスコープ外のもの」の表にこの行がある:

   | 乗り物（ボート / トロッコ）の**物理** | mx-gameplay | plan.md §3.11 |

   断っているのは「乗り物のルール」ではなく「乗り物の**物理**」である。
   `projectMinecartVelocity` をあちらに置くには、mc-physics が自分のスコープ表から
   1 行削る必要がある。

2. **置いても呼べない。** mc-physics の §4 は 親 = `mc-kernel` のみ / 子 = `mc-sim` のみ と書いており、
   本文書 §3 は「`mc-physics` を直接 import はできない（推移閉包禁止）」と書いている。
   `projectMinecartVelocity` を向こうに置くと、**1 つのレールルールの半分ずつが、
   互いを見られない 2 つのリポジトリに入る** —— 向こうは `RailShape` を import できず、
   こちらは向こうを import できない。

3. **「blocks/秒 だから物理」という当て方は、この組織では逆を向く。**
   mc-physics §3 は step-up について、**機構**（`ResolveOptions.stepHeight`）を自分に残し、
   参照実装の `MAX_STEP_UP = 0.6` という**ゲーム的なチューニング値のほうを mc-sim へ出している。**
   単位が速度や距離であることは mc-physics 行きの根拠にならず、むしろ出ていく根拠である。

**したがって分割はリポジトリの分割ではない。** plan.md §7 が §2 の表で
「乗り物（ボート/トロッコ/パワードレール）のルール → gameplay、**全部**」と書いているとおりで、
単独割り当ての 2 行のうちの 1 行である。実際にある線は所有権の線ではなく、
**いま到達できるか** の線である（§5-3）。

### 5-3. 到達できる半分と、できない半分

`domain/vehicle/rail-shape.ts` と `rail-ascent.ts` は、注入された述語 1 つで完結する。
`ChunkStoreApi` も `EntityManagerApi` も名指さず、import が 1 本も無い。**今日書けて、今日テストできる。**

`projectMinecartVelocity` は所有権としてはここのものだが、**書いていない。** 理由は 2 つある。

- **消費者が無い。** 呼ぶには「レールに乗っている実体の速度」が要る。`mc-sim` の
  `EntityState` は `feetPosition` / `healthPoints` / `behaviour` の 3 欄で、**速度の欄が無い**。
  ボートもトロッコも乗車状態も、`mc-sim` のどのファイルにも存在しない（§5-5）。
- **カートのルールの 3 分の 1 でしかない。** 残りは参照実装の
  `resolveMinecartMultiplier`（パワードレールの倍率。レッドストーンによる gating は
  `mx-redstone` の側で、参照実装でも先送りされている）と `RAIL_CLIMB_SPEED` である。
  3 分の 1 だけを export しておくと、残り 2 つが来た日に形が変わる。
  `domain/interactions/explosion-crater.ts` が「破壊ブロックのドロップ」を
  「消費するものがまだ無いので、ここで発明しない」と断ったのと同じ判断である。

### 5-4. `RAIL_CLIMB_SPEED = 3.5` を運ばない —— **転記であって、正当化ではない**

参照実装の doc comment はこう書いている:

> Vertical climb speed while ascending a sloped rail (blocks/second). Fast
> enough to mount a 1-block step within a cell's travel at minecart pace.

**この主張は参照実装の中で検算できない。** 「minecart pace」に当たる数は
`MINECART_SPEED_MULTIPLIER = 1.85`（`game-state-update-orchestration.ts:84`）で、
これは絶対速度ではなく**プレイヤー速度への倍率**である。したがって
「1 セル進む間に 1 ブロック登れる」かどうかは、この 2 つの数からは判定できない ——
プレイヤーの基本速度が要り、それは `mc-render` の入力と `mc-sim` にある。

つまり 3.5 は測定ではなく**転記**である。運べば「測定に見える転記」が 1 つ増える。
`domain/vehicle/rail-ascent.ts` の `RAIL_HEADING_EPSILON = 1e-9` は運んであるが、
**転記であることが定数の doc comment に明記してある** —— これが本節の要求する最低条件で、
`RAIL_CLIMB_SPEED` は消費者と一緒に、測定と一緒に来ればよい。

### 5-5. 次のリポジトリが用意すべきもの（この 2 本はまだフレームに配線されていない）

`stages/registration.ts` の 4 stage のどこからも、この 2 本は呼ばれていない。
**呼べないからであって、置き場が無いからではない。** 欠けているものを名指しで挙げる。

| 欠けているもの | どこ | いま何があるか |
| --- | --- | --- |
| 実体の**速度** | `mc-sim` の `EntityState` | `feetPosition` / `healthPoints` / `behaviour` の 3 欄のみ。速度は `mc-physics` の `Body`（`domain/integrate.ts:62`）にあり、`mc-physics` の子は `mc-sim` だけなので、名簿へ載せられるのは `mc-sim` である |
| 乗り物という**名簿の項目** | `mc-sim` | `minecart` / `boat` / `mount` / `ride` はどのファイルにも無い。`EntityKind` は非空文字列のブランド型なので**型の変更は要らない**が、実体を作るのは名簿の持ち主である |
| 乗車状態（誰が何に乗っているか） | `mc-sim` | 参照実装では `Ref<boolean>`（`game-state-service.ts:76`）。状態なので `mc-sim` のもの |
| 駐車した乗り物 | `mc-sim` | 参照実装の `packages/entity/application/parked-vehicle-service.ts` |
| `IsRailAt` を作る側 | ホスト | `mc-kernel` の `railKind`（`'none'` / `'normal'` / `'powered'`、120/120 に既出）から作る。**ブロック ID を名指してはならない**（plan.md §3.4）—— 参照実装の `isOnRail` はまさにそれをやっており、`domain/vehicle/rail-shape.ts` のヘッダがその行を引いている |

**`rail`(31) と `powered_rail`(32) は既に揃っている。** `mc-kernel` の `BLOCK_REGISTRY` にあり、
`domain/block-vocabulary.ts` にミラーされている（`test/block-vocabulary-mirror.test.ts` が固定）。
kernel への追加要求は 1 つも無い。

### 5-6. なぜ `domain/interactions/` ではなく `domain/vehicle/` なのか

[testing.md](./testing.md) §3-2 は当初この規則の置き場を `domain/interactions/rail-shape.ts` と書いていた。
**ディレクトリは plan.md §3.11 の責務に対応している** —— `domain/interactions/` は責務 1（採掘 / 設置 /
アイテム使用）、`domain/mob/` は責務 2 で、レールは責務 5 である。
`interactions/` に入れると、`stages/registration.ts` の `gameplay:interactions` に付いている
「破壊 / 設置 / バケツ / 火打石 / 弓 / 農業 / ハサミ / …」という約 40 ルールの列挙に、
そこに属さないルールが 1 本混ざることになる。testing.md 側の記述はこの節に合わせて直してある。

粒度の規則（DN-GP-9: 1 ルール 1 ファイル、stage 登録は増やさない）は守られている。
2 ファイル、2 ルール、**stage 登録は 0 本増**（`test/stage-registration.test.ts` が 4 本ちょうどを固定）。

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

## 6. ポータル（plan.md §3.11 の 6 番目）—— 3 ファイルの割れかたと、こちらの取り分

§2 の表はこのリポジトリの取り分を「**次元移動のルール**（ポータル成立条件・遷移の発火）」と書いている。
**その 2 つは同じ場所には無い。** 参照実装が既に 3 ファイルに割っており、割れ目は
[testing.md](./testing.md) §3-2 の表のとおりである。

| 参照実装のファイル | 何をするか | 行き先 | 状態 |
| --- | --- | --- | --- |
| `packages/world/domain/nether/portal-frame.ts` | 枠の**成立条件** | **mc-worldgen** | ✅ `detectNetherPortal` |
| `packages/app/.../interaction-flint-steel-portal.ts` | **遷移の発火**（点火） | **mx-gameplay** | ✅ `domain/interactions/ignite-portal.ts` |
| `packages/app/.../physics-stage-portal.ts` の**適用** | プレイヤーをそこへ置く | mx-gameplay | 🟡 **ミラーはある、呼び出しがまだ。ただし「繋ぐだけ」ではない**。`domain/player-port.ts` が `PlayerServiceApi.moveTo` をミラーし（`check:mirrors` 13/13 と `check:repoint` の監視下）、**いつ**は `domain/portal-dwell.ts` が答える。残る 2 つは配線ではない: **どこへ**を答えるはずの `resolveNetherTravel` は mc-worldgen の**バレルに無く**、引数 2 つにも所有者が居ない。`moveTo` の呼び出しは `makeGameplayStages` に `PlayerService` を名指すことなので、**`api-lock.md` が動く**。どちらも §6-2 に実測がある |

**成立条件が隣に行ったのは越境ではない。** mc-worldgen 側の判断であり、そのファイルの冒頭が根拠を書いている:
入力が全部ブロックデータで、実体を 1 つも知らない。plan.md §3.11 が 「ポータル / 次元移動ルール」 を
gameplay に与えているのは**動詞**についてであり、形についてではない。

**こちらはそれを import せず、ミラーする。** `domain/portal-frame-port.ts` が
`domain/chunk-store-port.ts` と同じ体裁で、同じ削除期日を持つ。
mc-worldgen のミラーが 2 本になったのは矛盾ではなく、`domain/chunk-store-port.ts` の冒頭が
書いている規則（**1 ミラー 1 ソースモジュール**、置き場は「どのバレルが置き換えるか」で決まる）に従った結果で、
mc-kernel に対する `domain/block-vocabulary.ts` と `domain/item-vocabulary.ts` が先例である。

### 6-1. 同期の `BlockAt` と `Effect` のあいだ

`detectNetherPortal` は**同期**の `(x, y, z) => number` を取り、1 回の呼び出しで最大 500 セルほど探る。
このリポジトリのブロック読みは全部 `Effect` である。`domain/chunk-window.ts` がその橋で、
その冒頭に**案を 3 つ並べ、落とした 2 つの理由**が書いてある。要点だけ:

- **セル単位で読む**: 探りうる範囲は 2 平面 × 44 × 44 で、右クリック 1 回あたり 3,872 回のストア呼び出し。
  枠を指していようが土壁を指していようが**全額**払う。コストで却下。
- **要求駆動の不動点**（キャッシュを外したセルを集めて読み、また回す）: 読み取り回数は答えに比例して安いが、
  ラウンド数が**他人の制御フローの深さ**に比例する。他リポジトリの分岐に依存した上限は上限ではない。
- **チャンクを peek してバッファを引く**: 9〜16 回の `peek` と、あとは純粋な配列読み。**これを採った。**
  参照実装の `buildBlockAtFromCache` と同じ形なので、発明ではなく移植である。

**近道は `ChunkNotLoaded` を潰さない。** そこが唯一気にすべき点で、2 段構えになっている:
`load` ではなく `peek` を使う（ルールがチャンクを常駐させるのは生成の決定であり、こちらのものではない）ことと、
常駐していないセル・世界の外の `y` が `UNREADABLE_BLOCK`（`-1`、どの registry 行でもない値）を返して
**数えられる**こと。読めないセルは air にも黒曜石にもならないので、**枠を作り出すことはできず、拒めるだけ**である。
`ignite-portal.ts` はその数を見て `NoFrame` と `ChunkNotLoaded` を**別の答え**として返す。

### 6-2. 3 本目が待っているもの —— **3 つあり、名詞はそのうち 1 つでしかない**

`physics-stage-portal.ts` はプレイヤーの位置を読み、十分に立ったと判断し、別次元へ置く。
この行は一度「**3 つとも揃っていて、繋いでいないだけである**」と書いていた。**測ったら誤りである。**
揃っているのは 1 つで、残り 2 つは配線では届かない。以下は全部実測である。

**(a) 次元という名詞には所有者が居ない。** これは以前から変わっていない。
`grep -rn "Dimension" mc-kernel/domain` は 0 件、mc-sim の `domain/` `application/` `index.ts` も 0 件、
`NetherService` はワークスペース中どこにも無く（当たるのはこのリポジトリの散文だけ）、
`setActiveDimension` も 0 件である。**欠けているメンバを正確に言えば
`PlayerServiceApi.dimension` と `PlayerServiceApi.setDimension` の 2 つで、
他のどのサービスにも代わりは無い。** `PlayerServiceApi` は 6 メンバ、
`EntityManagerApi<S>` は 10 メンバで、どちらも世界を 1 つも名指さない。
したがって**今日ここで書ける「移動」は 1 つの世界の中での再配置でしかなく、次元の切り替えは本当に無い。**
`travelToNether` という名前の関数を置くことはできない —— 座標を動かすだけのものにその名を付けるのが、
このリポジトリがバケツとハサミについて拒否した「発明」そのものだからである。

**(b) 「どこへ」は mc-worldgen のバレルに無い。** これは新しく測った分で、
上の表が「揃っている」と書いた根拠を直接壊す。mc-worldgen の `index.ts` は
`./domain/portal-frame` を出しているが `./domain/nether-travel` も `./domain/nether-link` も**出していない**。
`resolveNetherTravel` の `Dimension` は当該ファイルが「**PROVISIONALLY**」と書いて
意図的にバレルから外しているもので、理由は「綴りに依存されないようにするため」である。
**こちらがミラーすれば、まさにその綴りに依存することになる。**
引数も 2 つとも空である: `from: Dimension` は (a) のとおり出所が無く、
`knownPortals` は mc-worldgen 自身の `docs/responsibility.md` §6 が
「**世界に存在するポータルの一覧を所有するのが誰かはまだ誰にも割り当てられていない**」と書いている。

**(c) 残る `moveTo` の呼び出しは 1 行ではなく、公開面の判断である。**
`makeGameplayStages` に `PlayerService` を名指すと `api-lock.md` が動く。実測:

| 入れるもの | `api-lock.md` の差分 | supporting declarations | 何が公開面に入るか |
| --- | --- | --- | --- |
| 滞留 `Ref` だけ（`moveTo` を呼ばない） | +17 / -1 | 66 → 67 | `PortalDwell` |
| `PlayerService` を名指す | +97 / -4 | 66 → 78 | `PlayerService` / `PlayerService_base` / `PlayerServiceApi` / `PlayerPose` / `CameraPoseSnapshot` / `ClockPort` / `ClockPort_base` / `MonotonicTimeSecs` ほか |

**下の行は `ClockPort` ごと引き込む。** `scripts/api-lock.ts` の冒頭が
「`FrameServices = ClockPort` を 1.0.0 で凍結することがこの仕組みの要点である」と書いているものが、
mx-gameplay の supporting declarations に載る。

**そして上の行も 0 ではない**、というのがこの表のいちばん効く部分である。
`GameplayFrameState` / `gameplayStages` / `makeGameplayStages` / `gameplayModule` は
**4 つとも `index.ts` から出ており、4 つとも lock に描画される**。
フレームをまたぐ状態は `GameplayFrameState` の 1 フィールドとして持つほかなく、
そのフィールドは lock に出る。**つまりこのリポジトリでは「状態を持つルールを stage に配線する」ことは、
定義上 `api-lock.md` を動かす。**
`git log -1 -- api-lock.md` が `3ebf903`（弓とエンダーパール）を指しているのはそのためで、
あれが `Ref` を足した最後のラウンドである。以降の 2 ラウンド
（`85c0da8` ポータル滞留 + ネザー連結、`ec888b8` `PlayerService` ミラー）が 0 日で通ったのは、
**どちらもバレルに出ない `domain/` のモジュールしか足していない**からであって、
配線を含むラウンドが 0 日で通る道があったからではない。

**したがってこの行を閉じることは 4 週間の publish 時計を使う判断であり、配線作業ではない。**
判断そのものは記録されていないので、この行は 🟡 のままにしてある。

## 7. kernel への名簿要求 —— アイテム 8 語

責務 1 の「アイテム使用」で**書けなかったもの**の全部が、この 1 表である。
mc-sim の 7 語要求が先例で、**要求として出すのが正しく、こちらで綴るのは誤り**である
（kernel audit §4.9.1(c)）。

| 要求する語 | 何のルールが待っているか | ほかに要るもの |
| --- | --- | --- |
| `bucket` / `water_bucket` / `lava_bucket` | 汲む / 撒く（`interaction-bucket-handler/`）。流体側は `domain/fluid-frontier.ts` が既に持っている | なし。**語だけで書ける** |
| `shears` | 葉・草の採取、および羊の毛刈り | 毛刈りのほうは mc-sim の名簿（羊が要る） |
| `hoe` | 耕す（`dirt` / `grass_block` → `farmland`）。3 ブロックとも registry にある | なし。**語だけで書ける** |
| `bow` / `arrow` | 射る。**ルールは書けており、フレームからも回っている**（`domain/interactions/draw-bow.ts` / `bow-shot.ts` / `knockback.ts`） | なし。**語だけで閉じる**（§7-1） |
| `ender_pearl` | 投げる。**ルールは書けており、フレームからも回っている**（`domain/interactions/throw-ender-pearl.ts`） | なし。**語だけで閉じる**（§7-1） |

**5 行すべてが「語を足せば閉じる」になった。**
`flint_and_steel` と `fire_charge` は**既に kernel にある**ので、この表には無く、実装済みである。

### 7-1. 弓とエンダーパールの「ほかに要るもの」は**測って空だった**

この表の下 2 行は、以前こう書いていた:

> | `bow` / `arrow` | 射る | **発射体**。mc-sim の名簿と mc-physics の速度 |
> | `ender_pearl` | 投げる | **発射体**。同上。落下地点の判定も要る |
>
> **`bucket` 系と `hoe` は語を 1 行足せば閉じる。** 弓とエンダーパールは語が来ても閉じない ——
> そこが止まる場所で、`domain/mob/` がエンダードラゴンを拒否したときと同じ線である。

**参照実装を読んで確かめた結果、どちらも誤りである。** 発射体は 1 つも飛ばない。

- **弓は hitscan である。** `interaction-bow-handler.ts:200` のコメントが自分でそう言っている
  ——「Hitscan: find the nearest entity in the crosshair within bow range」——
  その次の行が呼ぶのは `findAttackableEntity`、**近接攻撃と同じ関数**で、
  違いは reach に `BOW_MAX_RANGE` を渡すことだけである。実体は 1 つも作られず、
  速度はどこにも書かれない。飛ぶのは装飾の粒子だけで、それはダメージを与えた**あとに**描かれる。
- **エンダーパールは `TargetRayHit` を取る。** `ender-pearl.ts:8` の import がそれで、
  ホストが**既に済ませた**レイキャストの結果である —— ブロックを設置する面を決めるのと同じ hit で、
  `ItemUseRequest` のコメントが「every rule in this repository is handed a cell」と書いているものである。
  同じフレームでプレイヤーが移動する（`:67`）。弧も無い。

**「落下地点の判定も要る」も同じ根から来ている。** 落下地点は無い。24 ブロック先か、
レイが当たったところか、どちらかである。

**これで 4 度目である。** エンダーマン（状態が型引数に乗っていた）、レールとポータル枠
（注入された述語で書ける純粋な規則、§3-2）、採掘のインベントリ行き（型の不一致が消えていた）、
そしてこれ。**4 つとも、もっともらしい「カテゴリ」から書かれた拒否である** ——
「位置を持つ実体を動かすもの」「発射体」——
そしてカテゴリは確かめられない。確かめられるのは**名前**だけである。

**残った 1 行は本物である。** `ITEM_TYPES` に `bow` / `arrow` / `ender_pearl` の綴りは無く、
書けばこのリポジトリが kernel の語彙を発明することになる（kernel audit §4.9.1(c)）。
その 3 語が無いことで**実際に失われているもの**は狙いでも命中判定でもなく、
**インベントリの出納**である: 矢を 1 本消費すること、弓の耐久を 1 減らすこと、
パールを 1 個消費すること。3 つとも `domain/inventory-port.ts` の `remove` を呼ぶ操作で、
`remove` は `ItemType` を取る。だから**今日配線された弓は矢を消費せず、無限に撃てる。**
`test/bow.test.ts` の「THE BOW FIRES FOR FREE」がそれを名指しで固定してあり、
3 語が来た日にそのテストが落ちる。

### 7-2. 弓が持ってきた、語とは無関係な穴が 1 つある —— **ブロックの貫通判定**

参照実装の弓は地形の遮蔽を見る（`interaction-bow-handler.ts:67-94`）。
こちらも `domain/interactions/bow-shot.ts` の `shotBlockedByTerrain` として**書いてあり、テストもある**が、
**stage からは呼ばれていない。** 呼ぶには `IsArrowBlockedAt`、すなわち
「このブロックは矢を止めるか」が要り、それは **kernel の能力（capability）** である。

`domain/block-vocabulary.ts` がミラーしている能力述語は 4 つ ——
`fallsWhenUnsupported` / `isReplaceable` / `validSpawnSurface` / `canSupportAttachments` ——
で、**どれも「発射体に対して固い」を意味しない。**
参照実装には表がある（`block-collision-predicates.ts` の `PASSABLE_BLOCK_IDS`）が、
それは kernel が publish すべきもので、こちらが転記するものではない。

`isReplaceable` で代用するのは**どちらの所有者も宣言していない等価を発明する**ことで、
`domain/entity-manager-port.ts` が `Position` と `BlockPosition` について断っているのと同じ形である
（形は同じ、意味は違う）。**したがって今日の弓は壁を撃ち抜く。**
述語を作る側はホストで、これは §5-5 が `IsRailAt` に与えた割り当てとまったく同じである。

**要求は語ではなく能力 1 つ**なので §7 の表には載せない。ここが唯一の記述である。

### 7-3. `computeKnockback` の所有権 —— §5-1 の判定をもう 1 ファイルに当てた

参照実装の `packages/entity/domain/combat-resolution.ts:111-119` は、
`rail-shape.ts` と同じく **1 ファイルに関心が 2 つ**入っている。§5-1 の判定
「**速度の「大きさ」が答えに届くか**」をそのまま当てると、真ん中で割れる。

| 記号 | 引数 → 戻り値 | 速度の大きさが答えに届くか | 行き先 |
| --- | --- | :-: | --- |
| **向き**（水平の単位ベクトル、および真上に飛ぶ退化ケース） | `(dx, dz)` → `KnockbackDirection` | **取らない**。唯一の呼び出し元が渡すのは**位置の差**（`interaction-bow-handler.ts:122-125`）で、その大きさは `Math.hypot` と除算で 1 行目に捨てられる | **mx-gameplay**。`domain/interactions/knockback.ts`（**実装済み**） |
| `KNOCKBACK_HORIZONTAL_SPEED = 5` / `KNOCKBACK_VERTICAL_SPEED = 4.2` | 定数（blocks/秒） | 速度そのもの | **mx-gameplay**。ただし**運ばない**（下記） |
| Punch の倍率 | `(level)` → 倍率 | **届く**。`1 + punchBonus / 5` の `5` は `KNOCKBACK_HORIZONTAL_SPEED` の裸のリテラルで、**無次元に見えるだけ**である | **mx-gameplay**。ただし速度と一緒に来る |

**向きの行は `isAscendingAhead` の行と同型である** —— 速度の形をした引数、
1 行目で捨てられる大きさ、正の定数倍に対する不変性。
そして `test/bow.test.ts` の
`SCALE-INVARIANT under positive factors` が `test/rail.test.ts` と同じやり方でそれを固定する。

**衝撃そのものを書かない理由は 2 つで、`projectMinecartVelocity`（§5-3）の 2 つである。**

- **置き場が無い。** mc-sim の `EntityState` は `feetPosition` / `healthPoints` / `behaviour` の
  3 欄で、速度の欄が無い —— §5-5 の 1 行目がカートについて言っているのと同じ観測である。
  参照実装には `entityManager.applyKnockback` があり、こちらのミラーには無い。
  代わりに `feetPosition` を書き換えるのは**別の規則**である（それはテレポートで、継続時間が無い）。
- **2 つの速度は転記であって測定ではない。** `combat.config.ts:57-58` に導出は無く、
  `RAIL_CLIMB_SPEED` と違って**検算すべき主張すら書かれていない**（§5-4）。

**mc-physics は 1 つも取らない。** 根拠は §5-2 の 3 つがそのまま当たる ——
向こうのスコープ表が戦闘のルールを手放していること、推移閉包禁止で import できないこと、
そして「単位が blocks/秒 だから物理」はこの組織では**逆を向く**こと。

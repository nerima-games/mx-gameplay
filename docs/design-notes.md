# 設計注意（DN-GP-1 〜 DN-GP-10）

本書は設計方針ではなく**事故報告**である。
10 項目のうち想像で書かれたものは 1 つもなく、すべて参照実装
（`/Users/take/ghq/github.com/takeokunn/ts-minecraft`。以下 `packages/…` はそのルート相対）の production で実際に起きたことか、
plan.md が実測知見として確定させたものである。

各項目は次の 3 つを必ず持つ。

1. **規則** — 何をしてよくて何をしてはいけないか
2. **根拠** — 参照実装の `path:line`、または plan.md の節番号
3. **回帰テスト** — このリポジトリで規則を固定しているテストの、**実在する describe / it のタイトル**

3 が無い項目は記録の不備であり、テストを書いて埋めること。

## 一覧

| # | 規則 | 主な根拠 | 固定しているテストファイル |
| --- | --- | --- | --- |
| DN-GP-1 | 落下ブロックはイベント駆動 | `falling-block-maintenance.ts:9-15` | `test/rules.test.ts` / `test/stage-registration.test.ts` |
| DN-GP-2 | 流体はフロンティア上限 | `fluid-tick-budget.ts:5-40` | `test/rules.test.ts` / `test/stage-registration.test.ts` |
| DN-GP-3 | 死因を死亡メッセージまで運ぶ | `physics-stage-health.ts:32-34` | `test/rules.test.ts` |
| DN-GP-4 | このリポジトリは分割しない | plan.md §3.11 / §5.3 | `test/check-dependency-whitelist.test.ts` |
| DN-GP-5 | `after` は制約のみ / 全順序は compose | plan.md §2.3-3 | `test/stage-registration.test.ts` / `test/public-api.test.ts` |
| DN-GP-6 | 再入可能な初期化 | plan.md §3.8 | `test/stage-registration.test.ts` |
| DN-GP-7 | `TimeService` の順序ハザード | plan.md §3.8 | `test/stage-registration.test.ts` |
| DN-GP-8 | `Date.now()` 禁止 | plan.md §4.3 / §5.1-3 | `test/check-dependency-whitelist.test.ts` |
| DN-GP-9 | 1 ルール 1 ファイル、しかし 1 stage | plan.md §3.11 | `test/stage-registration.test.ts` |
| DN-GP-10 | `Ref.modify` で TOCTOU 回避 | plan.md §3.8 | （現状はコードレビュー規範。§DN-GP-10 参照） |

---

## DN-GP-1 落下ブロックはイベント駆動

**規則**: 砂・砂利の落下は、ブロックが変化した位置を起点とするキューで処理する。
**「ロード済みチャンクを走査する」関数を書かない。**

### 根拠

参照実装は当初、メンテナンス tick ごとに全ロード済みチャンクを走査して支えを失った砂・砂利を探していた。
修正時に自分で書き残したコメントが `packages/world/application/falling-block-maintenance.ts:9-15` にある。

> Falling blocks are primarily EVENT-driven (chunks whose blocks changed since the last tick,
> via the frame's dirty-chunk map); the sweep exists only to catch mutation paths that bypass
> that map (e.g. fluid updates). Scanning every loaded chunk every tick — the previous behaviour
> — cost **~7M+ block reads per 16-48ms maintenance tick (~40% of the main thread while exploring)**;
> two chunks per tick is ~0.05ms.

コストは O(chunks × blocks) で、**何も動いていなくても同じだけ払う**。
探索中はメインスレッドの約 4 割がこれに消えていた。

per-tick 上限は `packages/world/domain/falling-block.ts:7` の `FALLING_BLOCK_MAX_PER_TICK = 32`。
このリポジトリの `FALLING_BLOCK_MOVES_PER_TICK` は同値である。
上限があることで、砂漠の下での TNT 爆発のような病的なイベントバーストが、
フレームスパイクではなく**数 tick に広がる目に見えるカスケード**に変わる。

カスケードの継続には別の仕組みが要る。落下する柱は 1 tick に 1 セルしか沈まないので、
移動先を次の tick に再検査しなければ砂が 1 セル手前で止まる。
参照実装はこれのために `pendingCoordKeysRef` を持っていた（`falling-block-maintenance.ts:24-27`）。
このリポジトリの `settled()` がその機構で、粒度はチャンクではなく位置である。

### 構造的な防御

このリポジトリの `domain/falling-block.ts` には**「世界を走査する」関数が 1 つも無い**。
仕事がキューに入る経路は `disturb` だけ、取り出す経路は `takeBatch` だけである。
つまり参照実装の間違いは「うっかり」では再現できない — 存在しない関数を呼ぶ必要がある。

これがこのリポジトリでの防御の基本形である。規律ではなく形で防ぐ。

### 回帰テスト

`test/rules.test.ts`、describe:
**`falling blocks: the O(chunks × blocks) full scan must not come back`**

| it |
| --- |
| `` REGRESSION: an untouched world produces no work, because work only enters through `disturb` `` |
| `REGRESSION: one tick applies at most FALLING_BLOCK_MOVES_PER_TICK moves` |
| `` REGRESSION: `settled` re-queues a destination so a column keeps cascading without an external event `` |
| `re-disturbing a pending position keeps its original queue position, so a hot spot cannot starve the queue` |
| `a zero or negative budget takes nothing rather than throwing or taking everything` |
| `disturb does not mutate the queue it was given` |

`test/stage-registration.test.ts`、describe `stage behaviour`:

| it |
| --- |
| `REGRESSION: an idle tick does no falling-block work at all (the O(chunks × blocks) scan is gone)` |
| `REGRESSION: a burst of disturbances is spread across ticks by the per-tick move budget` |
| `takeBatch preserves disturbance order, which is what makes a scenario test an oracle` |

最初の 2 本は同じ規則を**単体**と **stage 経由**の両方で押さえている。
stage 側があるのは、`domain/` が正しくても `run` の中で全走査を書けてしまうからである。

`domain/falling-block.ts` の冒頭コメントもこの 2 本を名指ししている。
規則とテストの対応を**コード側にも**書いておくのは、テストを消す変更が
「なぜこのテストがあるのか」を読まずに通ってしまうのを防ぐためである。

---

## DN-GP-2 流体はフロンティア上限

**規則**: 流体伝播は**フロンティア**（近傍が変化したセル）だけを対象にし、
1 tick あたりの処理数に**ハード上限**を置く。水と溶岩は 1 つの予算を分け合う。

### 根拠

plan.md §3.11:

> 流体伝播はフロンティアサイズに上限（O(frontier)/tick が **37〜55倍**の性能改善をもたらした）

参照実装は同じ数字を反対側から記録している。
`docs/reference/shipping-readiness-2026-07-10.md:51`（2026-07-10 の CDP プロファイリング結果）:

> Fluid simulation event-driven rework: **37–55× on its hot path**.

改善に効いた考えは 2 つあり、このリポジトリは両方を再現している。

1. 全流体セルではなく**フロンティア**を回す。
2. フロンティアを **tick ごとに打ち切る**。水と溶岩が予算を共有するので、
   溶岩の大流出が水の伝播を飢えさせることも、その逆も起きない。

### 予算配分は参照実装の逐語再現

`packages/world/application/fluid-tick-budget.ts:5-40` の `splitBudget` が原本である。
:13-17 のコメントが意味を明示している。

> Single classification pass instead of separate filter/filter/filterMap sweeps + take/appendAll
> intermediates. Semantics are unchanged: **water takes up to half the budget, lava fills the
> remainder (only when its tick is active), and when lava's tick is inactive its frontier keys
> are retained for the next tick.**

セマンティクスは 3 つ。

| | 参照実装 | このリポジトリ |
| --- | --- | --- |
| 水は予算の**半分まで** | `:25-26` `halfBudget = Math.floor(budget / 2)` / `waterSliceLen = Math.min(water.length, halfBudget)` | `splitBudget` の `waterSliceLength` |
| 溶岩は**残りを埋める**（自分の tick が有効なときだけ） | `:27-28` `lavaAvail = lavaTickActive ? lava.length : 0` / `lavaSliceLen = Math.min(lavaAvail, budget - waterSliceLen)` | `lavaAvailable` / `lavaSliceLength` |
| 溶岩の tick が無効なとき、フロンティアは**捨てずに保持** | `:34-37` `if (!lavaTickActive) { … retainedLavaFrontier.push(lava[i]!.key) }` | `retainedLavaFrontier` |

**間違えやすいのは 3 番目である。** 捨てても何も落ちない。型エラーも例外も出ない。
症状は数分後にプレビューで現れる — **溶岩湖の縁が直線になる**。
流れの途中で止まった溶岩は、そこから先に広がる理由をもう持っていないからである。

このリポジトリでは `splitBudget`（何を評価するか）と `carryOver`（何を次に持ち越すか）を
**別関数に分けてある**。2 つの答えは行き先が違う（前者は伝播ルール、後者は stage の状態）。
1 つの戻り値に融合すると、参照実装と同じく片方だけ使って片方を落とす経路ができる。

### 既知の限界（silently「修正」しないこと）

**水だけのフロンティアは、予算の半分しか使わない。** 水は常に `floor(budget / 2)` で頭打ちなので、
溶岩が 0 本でも空いた半分は使われない。

これは参照実装のセマンティクスの逐語再現であり、**望ましい挙動として記録しているのではない**。
直すなら測定してから直す。憶測で「もったいないから空きを水に回す」と変えると、
37〜55 倍を出した実測条件から静かに外れる。

このことは `test/rules.test.ts` の
`water takes the whole budget when there is no lava, rather than leaving half of it idle` に
コメントつきで記録してある。**このテストのタイトルは願望であり、assertion（`toHaveLength(32)`、予算 64）は
現実である。** 食い違いは意図的で、タイトルが「いつか直したいこと」、assertion とコメントが
「今そうなっていること」を示す。将来ここを変えるときは、タイトルではなく測定を根拠にすること。

### 回帰テスト

`test/rules.test.ts`、describe:
**`fluids: the frontier budget that bought 37–55×`**

| it |
| --- |
| `REGRESSION: work never exceeds the budget, however large the frontier grows` |
| `REGRESSION: lava cannot starve water — water is guaranteed half the budget` |
| `water takes the whole budget when there is no lava, rather than leaving half of it idle`（**既知の限界の記録**） |
| `REGRESSION: an inactive lava tick RETAINS the lava frontier instead of dropping it` |
| `carryOver returns exactly the cells that were not evaluated` |
| `a zero budget evaluates nothing and loses nothing` |

`test/stage-registration.test.ts`、describe `stage behaviour`:

| it |
| --- |
| `REGRESSION: lava keys survive the ticks on which lava is not scheduled` |

なお `LAVA_TICK_INTERVAL = 4` と `DEFAULT_FLUID_FRONTIER_BUDGET = 64` は**暫定値**である。
上限が存在することが荷重を担っている部分で、数字はつまみである。出荷値は流体プレビューで測って決める。

---

## DN-GP-3 死因を死亡メッセージまで運ぶ

**規則**: ダメージは必ず死因を伴う。`Damage.cause` は **required** であり、
量だけを受け取るオーバーロードを作らない。

### 根拠

plan.md §3.11:

> 死因はドロップせず死亡メッセージまで運ぶ（参照実装では全死亡が「You died.」になるバグがあった）

参照実装の事後記録が `packages/app/application/frame/stages/physics-stage-health.ts:32-34` にある。

> Forward the cause: survival effects (lava/fire/drowning/…) pass one and the death screen
> renders it — **a (amount)-only closure silently dropped every cause and made all deaths read
> as the generic "You died."**

### このバグの形

見るべきはバグの**形**である。

- 何もクラッシュしていない。
- 型に違反していない。
- テストが 1 本も落ちていない。

起きたのは、中間ヘルパが `(amount: number) => …` として書かれ、**省略可能な引数が呼び出し境界で消えた**ことだけである。
その結果、`packages/entity/domain/player-damage-cause.ts:31` の `generic: 'You died.'` が全死亡で採用され、
`packages/presentation/menu/death-screen-dom.ts:35` が常にその 1 文を描いた。

省略可能な引数は、消えても誰も何も言わない。これが再発防止を規律に頼れない理由である。

### 構造的な防御

`domain/death-cause.ts` の防御は 3 点。

1. `cause` は `Damage` の**必須フィールド**。
2. 体力を減らす経路は `applyDamage` **だけ**。
3. 量だけを取るオーバーロードが**存在しない**。

参照実装のバグをここで書くには、引数を忘れるのでは足りず、**型からフィールドを削除する**必要がある。

### 死因は「とどめの一撃」だけを記録する

溶岩に落ちたプレイヤーは、まず落下ダメージを、次に燃焼ダメージを受ける。
メッセージが名指しすべきは実際に殺したほうである。

参照実装の `packages/entity/application/health-service.ts:82`:

```typescript
lastDeathCause: justDied ? Option.some(cause) : s.lastDeathCause,
```

`justDied`（生きていた → 体力 0）への遷移時にだけ書く。このリポジトリの `applyDamage` も同じで、
加えて**死体への追撃は無視する**（クリーパーが二度目に当たっても死亡メッセージは書き換わらない）。

### 回帰テスト

`test/rules.test.ts`、describe:
**`death: "You died." must not be the only message the game can print`**

| it |
| --- |
| `REGRESSION: a fatal lava blow reports lava, not the generic fallback` |
| `REGRESSION: every non-generic cause has its own message` |
| `REGRESSION: only the killing blow sets the cause, so falling into lava reports lava` |
| `REGRESSION: damage to an already-dead player does not rewrite the death message` |
| `a living player has no death message` |
| `a hand-built dead Vitals with no recorded cause still gets a message rather than nothing` |
| `health never goes below zero and negative damage never heals` |

`generic` は正当な死因である（`/kill`、原因不明の defect）。
「本当の死因を失った」の代用ではないので、テストは**他の 10 個が `generic` に落ちないこと**を assert する。

最後から 2 番目は `deathMessage` の `?? 'generic'` を固定している。
`applyDamage` は必ず死因を記録するのでこの経路は到達不能に見えるが、
オブジェクトリテラルからは到達できる（QA API、セーブのマイグレーション、テスト）。
**文章が 1 つも出ない死亡画面は、汎用の 1 文が出るより悪い**ので、全域関数として閉じてある。

---

## DN-GP-4 このリポジトリは分割しない

**規則**: `mx-gameplay` を採掘 / 農業 / 戦闘などのリポジトリに分けない。

### 根拠

plan.md §3.11:

> このリポジトリは変更頻度が最も高くなる（参照実装で **200 commits/3ヶ月**）。
> さらなる分割（採掘/農業/戦闘の個別リポジトリ化）はしない —
> **共通のstage契約を共変更する一枚岩であり、狭い界面が存在しない**

plan.md §5.3（採らない細分化の確定表）:

> | mx-gameplay のさらなる分割 | 共通の stage 契約を共変更する一枚岩。自己完結だったレッドストーンは分離済みで、残りに狭い界面がない |

論拠の詳細は [responsibility.md](./responsibility.md) §5 に展開してある。要点は、
分割の是非を決めるのは規模ではなく**界面の狭さ**だということ。
`mx-redstone` は電力グラフという自己完結した内部を持っていたので分けられた（plan.md §3.12）。
採掘と農業の間にはその境界が無い。

### 帰結

分割で逃げられない以上、境界の維持は**ゲート**に任せるしかない。
`test/check-dependency-whitelist.test.ts` の冒頭コメントがこう書いている。

> A repository that changes constantly and is never allowed to split is precisely the one that
> will grow an import it should not have, so these assertions matter more here than anywhere else.

### 回帰テスト

`test/check-dependency-whitelist.test.ts` 全体（17 本）。特に:

| describe | it |
| --- | --- |
| `mx-gameplay dependency policy` | `declares exactly the parents plan.md §3.11 gives it: sim, worldgen, audio` |
| `§2.3-1: zero dependency edges between experience modules` | `REGRESSION: no experience module names another experience module in the graph` |
| `§2.3-1: zero dependency edges between experience modules` | `REGRESSION: importing mx-redstone, mx-ui or mx-multiplayer is rejected outright` |
| `no transitive closure` | `REGRESSION: mx-gameplay may NOT import mc-physics just because mc-sim does` |
| `no transitive closure` | `REGRESSION: mc-save and mc-meshing are equally out of reach` |
| `§2.3-2: mc-playground-kit is devDependency-only` | `` REGRESSION: `stages/` counts as shipped source, not as tooling `` |
| `the roster, read from the seat of another repository` | `REGRESSION: seated in mx-ui, importing mx-gameplay is rejected — the zero-edge rule is symmetric` |

最後の 1 本は**規則が対称であること**を確かめている。
こちらが兄弟を import しないだけでは足りず、兄弟からこちらも import できない必要がある。
自分の席からは自分の行しか検査されないので、`PolicyView` を差し替えて他リポジトリの席から読む
（[testing.md](./testing.md) §2-3）。

---

## DN-GP-5 `after` は制約のみ / 全順序は mc-compose

**規則**: `StageRegistration.after` は**順序制約の宣言だけ**である。
自分の絶対位置を主張しない。順序を解決する関数をここに公開しない。

### 根拠

plan.md §2.3-3:

> **stage 実行順序表は compose が唯一所有する。** 各モジュールは順序制約（`after`）を宣言するだけで、
> 全順序は compose が解決する

理由は単純で、モジュールは他のモジュールを見られないので、
自分が全体の何番目であるべきかを**正しく決められない**。決めれば必ず間違える。

### 文字列という穴

`after` に書くのは `StageId` = 文字列である。したがって

```typescript
after: [StageId('ui:hud-sync')]
```

は **import を 1 つも作らない**。`pnpm check:deps` は通る。
それでいて `mx-gameplay` のフレーム位置は `mx-ui` の存在に結びついている。
コンパイラにも import ゲートにも見えない依存が 1 本増えた状態である。

だから `stages/stage-ids.ts` は、このリポジトリが書き下ろす `StageId` を**全部 1 ファイルに集めて**いる。
`GAMEPLAY_STAGE_IDS`（所有するもの）と `UPSTREAM_STAGE_IDS`（他人を名指しするもの）に分かれており、
「`mx-gameplay` は何の後ろで走ると主張しているのか」を**一度に読める**ようにしてある。
散らばっていたらレビューは不可能である。

宣言が最小である理由（`sim:physics` 1 本だけ）は [public-api.md](./public-api.md) §4。

### 回帰テスト

`test/stage-registration.test.ts`、describe:
**`§2.3-1 zero edges between experience modules`**

| it |
| --- |
| `` REGRESSION: no `after` edge names another experience module, so mx-gameplay cannot be ordered against mx-redstone/mx-ui/mx-multiplayer `` |
| `REGRESSION: every declared upstream stage belongs to a foundation repository, never to a sibling` |

describe: **`§2.3-3 the total order belongs to mc-compose`**

| it |
| --- |
| `` REGRESSION: this repository exposes no way to resolve a total order — only `after` constraints `` |
| `the declared constraints form the §4.2 skeleton fragment gameplay is responsible for` |
| `` a consumer that ignores the array order and honours only `after` still gets a legal schedule `` |
| `StageId rejects a blank id, so a stage cannot register itself as an unnameable vertex` |

1 本目は各 stage のキーが `['after', 'id', 'run']` **ちょうど**であることを assert する。
将来 `priority` / `index` を足そうとすれば、そこで止まる。
3 本目は配列を逆順にすると制約が満たされなくなることを示す — **配列順は順序ではない**ことの証明である。

`test/public-api.test.ts`、describe **`public API surface`**:

| it |
| --- |
| `REGRESSION: exports nothing that would let a consumer resolve a total stage order` |

`sortStages` / `stageOrder` / `totalOrder` / `framePipeline` / `runFrame` がバレルに現れないことを assert する。
registration の**形**を見る上の 1 本目とは別の面 — **モジュールの表面**を見ている。
`sortStages()` は `StageRegistration` を 1 つも変えずに追加できてしまうので、
形の検査だけでは止まらない。

---

## DN-GP-6 再入可能な初期化

**規則**: フレーム状態はシングルトンにしない。`makeGameplayFrameState` は **Effect** であり、
呼ぶたびに独立した状態を返す。

### 根拠

plan.md §3.8:

> **ゲームループ・自動保存は `forkDaemon`**（スコープ非依存）+ 明示 `stop()`。
> **参照実装では2周目ワールドのデッドロック/やり残しfiberが最大級のバグ源だった。**
> アプリスコープのシングルトンは**再入可能な初期化**を最初から

2 周目のワールドロードが 1 周目の fiber と Ref を引き継ぎ、デッドロックする。
参照実装で最大級のバグクラスだった。

このリポジトリでは症状はもっと地味に出る。
プレビューを 2 つ同時に立ち上げると、両者が同じ流体フロンティアを共有する。
片方でバケツをこぼすと、もう片方の世界に溶岩が流れる。

### 実装

```typescript
export const makeGameplayFrameState: Effect.Effect<GameplayFrameState> = Effect.gen(function* () { … })
```

定数ではなくファクトリである。2 つのプレイグラウンド、あるいはテストと本番ゲームが、
それぞれ自分の状態を持てる。後から再入可能にするより最初からのほうが安い。

### 回帰テスト

`test/stage-registration.test.ts`、describe `stage behaviour`:

| it |
| --- |
| `each call to makeGameplayFrameState yields independent state (re-entrant initialisation)` |

---

## DN-GP-7 `TimeService` の順序ハザード

**規則**: 昼夜の進行を `advanceTimeOfDay(now, dt, length)` という**純関数**で表す。
派生値を保持しない。

### 根拠

plan.md §3.8:

> `TimeService`: `setDayLength()` が tick 分母を変えるため、必ず `setDayLength → setTimeOfDay` の順

参照実装は「日の長さ」から導出した分母を保持していたので、
`setTimeOfDay` を先に呼ぶと**古い分母で計算された時刻**が残った。
呼び出し順が仕様の一部になっている状態で、これは呼び出し側全員が覚えていなければならない規則である。

### 純関数にすると規則ごと消える

`advanceTimeOfDay(currentSecs, dt, dayLengthSecs)` は 3 つの引数だけから答えを作る。
**保持している派生値が無いので、stale になり得る値が存在しない。**
順序ハザードは「回避される」のではなく、**存在しなくなる**。

これは規則を守る代わりに規則が不要な形を選ぶ、という DN-GP-1 / DN-GP-3 と同じ手口である。

`dayLengthSecs <= 0` はゼロ除算ではなく呼び出し側のエラーとして扱い、時刻を据え置く。

### 回帰テスト

`test/stage-registration.test.ts`、describe `stage behaviour`:

| it |
| --- |
| `advanceTimeOfDay is pure, so changing the day length cannot leave a stale derived value` |
| `time/weather advances by dt and wraps at the day length` |
| `a stage tolerates dt = 0, because a frame may be scheduled twice inside one clock tick` |

1 本目は `advanceTimeOfDay(95, 10, 100) === 5` と `advanceTimeOfDay(95, 10, 50) === 5` を並べて、
**日の長さを変えても即座に正しい答えが出る**ことを示している。

---

## DN-GP-8 `Date.now()` 禁止

**規則**: `Date.now()` / `new Date()` / `performance.now()` を書かない。
時刻は注入された Clock Port から取る。

### 根拠

plan.md §4.3:

> クロック Port — 決定論・fast-forward の要。**`Date.now()` 直接参照禁止**

plan.md §5.1-3（初日から焼き込むもの）:

> **クロック注入による決定論**。全シミュレーションが fast-forward 可能

このリポジトリにとっては死活問題である。昼夜サイクル、流体の tick 間隔、Mob のクールダウン —
時間を読むものが多く、壁時計を 1 箇所でも直読みすると、
**そこから先のシナリオテストが実時間でしか走らなくなる**。「1 ゲーム日を回して天候を assert」が 20 分かかる。

### oxlint では表現できない

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装していない。
`no-restricted-globals` は `oxlint --rules` の一覧に出るが**実装されていない**
（0.12.0 で実測確認済み。3 ルールすべてを設定した状態でも `Date.now()` を含むファイルの診断が 0 件）。

そのため禁止は `scripts/check-dependency-whitelist.ts` 側で実装してある。
コメント・文字列リテラル・正規表現リテラルの中身はマスクされるので誤検知しない。
`oxlint.json` にはこの経緯がコメントで残してあり、`no-restricted-globals` の行も
「意図の表明として、かつ oxlint が実装した日のために」置いてある（0.12 では不活性）。

oxlint が該当ルールを実装したら `oxlint.json` へ移し、スクリプトの time-source セクションを消す。

### 回帰テスト

`test/check-dependency-whitelist.test.ts`、describe:
**`§4.3: the clock is injected, never read from a global`**

| it |
| --- |
| `REGRESSION: Date.now(), new Date() and performance.now() are all rejected` |
| `a mention of Date.now() inside a comment or a string is not a violation` |

2 本目が重要である。誤検知するゲートは無効化されるので、
**マスク処理そのものを固定しておかないとゲートが長生きしない。**

---

## DN-GP-9 1 ルール 1 ファイル、しかし 1 stage 登録

**規則**: ルールは 1 本 1 ファイルに分ける。**stage 登録は増やさない。**

### 根拠

plan.md §3.11:

> **内部構成**: 参照実装の interaction-*.ts（40ファイル）の粒度を維持 — **1ルール1ファイル**。
> stage登録は `StageRegistration` で宣言

実測（2026-07-26、`wc -l`）: `packages/app/application/frame/stages/interaction-*`（サブディレクトリ含む、非テスト）は
**40 ファイル / 3,317 LOC**。詳細は [porting.md](./porting.md)。

### 2 つの粒度は別物

| 粒度 | 誰のためか | 単位 |
| --- | --- | --- |
| ファイル | **レビュー** | 1 ルール（破壊 / 設置 / バケツ / 火打石 / 弓 / 農業 / ハサミ / …） |
| stage 登録 | **合成** | 1 責務（`gameplay:interactions`） |

`mc-compose` が見るのはフレーム契約であり、責務ごとに 1 つずつ見えるべきである。
40 個の `StageRegistration` を渡したら、compose の順序表は 40 行の順序制約を解く羽目になる。
それは compose に `mx-gameplay` の内部構造を漏らしている。

逆に 1 ファイルに 40 ルールを詰めれば、変更頻度 200 commits/3 ヶ月のリポジトリで
毎回コンフリクトする 3,000 行のファイルができる。

**多数のファイル、1 つの登録。** これが両方を満たす唯一の形である。
`stages/stage-ids.ts` の `interactions` のコメントに同じことが書いてある。

### 回帰テスト

`test/stage-registration.test.ts`、describe `§2.3-3 the total order belongs to mc-compose`:

| it |
| --- |
| `the declared constraints form the §4.2 skeleton fragment gameplay is responsible for` |

このテストは stage id の配列が
`[interactions, entities, fluids, timeWeather]` の **4 本ちょうど**であることを assert する。
41 本目のルールを足したときに登録が 5 本目に増えていたら、ここで落ちる。

---

## DN-GP-10 `Ref.modify` で TOCTOU 回避

**規則**: `Ref` の read-modify-write を `Ref.get` → `Ref.set` の 2 段で書かない。
`Ref.modify` / `Ref.update` / `Ref.updateAndGet` を使う。

### 根拠

plan.md §3.8、Effect 規約の実測知見:

> Effect規約: ブランデッドコンストラクタ必須、**`Ref.modify` で TOCTOU 回避**、
> `Effect.catchAllCause`（defect をログに出す）

get してから set するまでの間に別の fiber が同じ `Ref` を書けば、その書き込みは消える。
このリポジトリの `Ref` は落下ブロックのキューと流体フロンティアで、
どちらも「イベントで足され、tick で取り出される」形をしているので、
まさに複数の書き手が同時に触る位置にある。何かが `fork` した瞬間に競合する。

### 実装

`stages/registration.ts` の `gameplay:entities` はこう書かれている。

```typescript
run: () =>
  Ref.modify(state.fallingBlocks, (queue) => {
    const { batch, rest } = takeBatch(queue)
    return [batch, rest] as const
  }).pipe(Effect.asVoid),
```

`takeBatch` が「取り出したバッチ」と「残りのキュー」の両方を返す形になっているのは、
`Ref.modify` の `(a) => [b, a]` シグネチャにそのまま乗せるためである。
API の形が正しい書き方を誘導している。

`gameplay:fluids` の tick カウンタも `Ref.updateAndGet` を使う。

### 回帰テスト

**現状、この規則を直接固定しているテストは無い。** コードレビュー規範である。

TOCTOU は単一 fiber のテストでは再現しない — 落ちるのは並行実行下だけで、
それを決定論的に踏むにはスケジューラの介入点を握る必要がある。

`REGRESSION: a burst of disturbances is spread across ticks by the per-tick move budget`
（`test/stage-registration.test.ts`）が間接的に効いている。
`Ref.get` → `Ref.set` に書き換えても単体では通ってしまうので、これは防御ではなく足場である。

実装が進んで stage が本当に並行に走るようになった時点で、
`Effect.all` で `disturb` を並行発行して総数を assert するテストを足すこと。
そこで初めて `Ref.modify` かどうかが観測可能になる。

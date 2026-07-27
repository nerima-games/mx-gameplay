# 公開 API

## 1. 公開 API は stage 登録だけである

**`mx-gameplay` が他リポジトリに対して公開しているのは `StageRegistration` の配列 1 つだけで、
サービスは 1 つも公開していない。**

これは実装が未熟だからではなく、体験モジュールの定義そのものである。
**ルールはサービスではない。** 他リポジトリが `mx-gameplay` に尋ねたくなることを列挙すると、
「今インベントリに何が入っているか」「あの Mob はどこにいるか」「今何時か」— 全部**状態への問い合わせ**であり、
状態は `mc-sim` か `mc-worldgen` にある。`mx-gameplay` に聞くべきことは残らない。

`mc-compose` が消費するのは `makeGameplayStages` ただ 1 つである。

```typescript
import { makeGameplayStages } from '@nerima-games/mx-gameplay'
```

`index.ts` はこれ以外にも多くを export しているが、それらは**このリポジトリ自身のテストとプレビューが
直接叩く単位**として見えているだけで、他リポジトリが import することを想定していない。
どれがどちらかは §5 の表に全部書いてある。

## 2. 契約（plan.md §4.1 逐語）

```typescript
interface StageRegistration {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>   // 順序制約の宣言のみ。全順序は compose が解決
  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
}

interface GameModule<ROut, E, RIn, RRegister = never> {
  readonly layers: Layer.Layer<ROut, E, RIn>          // 提供するサービス群
  readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>
}
```

この型は本来 `mc-kernel` の資産である。`domain/frame-contract.ts` はそれを**ローカルに再掲**したもので、
mc-kernel が publish された時点で削除される（[versioning.md](./versioning.md) §5）。
**そのため `index.ts` はこのファイルを re-export しない** — 所有していない型を公開 API に載せると、
約束済みの削除が消費者にとっての破壊的変更になる（§5）。
`interface` のまま写してあるのは仕様とコードを字面ごと一致させるためで、
`@typescript-eslint/consistent-type-definitions` の例外を `oxlint.json` に明記してある。

`FrameServices` だけは kernel と意図的に食い違わせてあり、ここでは `never` である。
kernel の `ClockPort` を再掲すると**同じ文字列 ID を持つ別の `Context.Tag`** が 2 つできる。
それは「型が狭い」より遥かに悪い壊れ方なので、狭いほうを選んでいる。
`Effect<void, never, never>` は `Effect<void, never, ClockPort>` が要求される位置に代入できるため、
このファイルに対して書かれた stage は kernel import に差し替えても型検査を通り続ける。

### 2-1. `GameModule` を実装した（`gameplayModule`）

ここには長らく「`GameModule` はまだ実装していない。`RIn` は mc-sim の公開 API が存在するまで
名前を付けられないから」と書いてあった。**診断は半分間違っていて、間違っていた側が重要だった。**

Layer は障害ではなかった。mx-gameplay は他リポジトリが呼ぶサービスを 1 つも公開しない
（ルールはサービスではない。他リポジトリが本リポジトリに尋ねたくなることは実際には状態への問いであり、
状態は mc-sim か mc-worldgen にある。plan.md §2.3-1）。だから `layers` は空であり、最初から空だった。

本当の障害は **`frameStages` が配列だったこと**である。本リポジトリの stage は Effect の中で確保した
`Ref` から組み立てられるので、`ReadonlyArray` 型のフィールドに入れる方法が無かった。
mc-sim が publish されても解決しない。縦切りスパイクが `frameStages` を Effect にしたことで解決した。

```typescript
export const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, ChunkStore>

export const gameplayModule: GameModule<never, never, never, ChunkStore> = {
  layers: Layer.empty,
  frameStages: makeGameplayStages,
}
```

### 2-2. `RRegister` は `ChunkStore | EntityManager` になった。`RIn` は `never` のままである

ここには「mx-gameplay が他リポジトリのサービス越しに書き込みを始めるとき、それらは `frameStages` の中で
— つまり `RRegister` パラメータで — 取得される」と**予告**が書いてあった。そのとおりになった。
stage がブロックを読み書きするようになったので、**登録**するのに mc-worldgen の `ChunkStore` が要る。
そして stage が Mob を反復するようになったので、mc-sim の `EntityManager` も要る。

2 つのパラメータの違いがここで初めて観測できる。

| | 値 | 意味 |
| --- | --- | --- |
| `RIn` | `never` | 本リポジトリが**構築**するのに要るもの。`layers` が空なので何も要らない |
| `RRegister` | `ChunkStore \| EntityManager` | 本リポジトリが stage を**登録**するのに要るもの |

本リポジトリは他リポジトリが供給しなければならないものを構築するのではなく、
他リポジトリが供給するものを**呼ぶ**だけである。だから `RIn` は増えない。

**`run` の側は増えてはならない。** `StageRegistration.run` の文脈は kernel の `FrameServices` であり、
そこに `ChunkStore` を要求することは kernel に mc-worldgen のサービスを名指しさせることになる
（階層モデル、plan.md §2.2 が禁じている）。だから store と roster は登録時に 1 度だけ取得し、4 stage が共有する。
固定しているテスト: `` REGRESSION: the store is acquired at registration, never demanded by `run` ``、
`acquires exactly two services to register — the store and the roster, in frameStages`
（`test/stage-registration.test.ts`）。

`ChunkStore` は mc-worldgen が publish されるまで `domain/chunk-store-port.ts` のミラーから、
`EntityManager` は mc-sim が publish されるまで `domain/entity-manager-port.ts` のミラーから来る。
どちらも `index.ts` から re-export していないが、`makeGameplayStages` の型に現れる以上、
消費者には見える —— `api-lock.md` の "Supporting declarations" に
`ChunkStore` / `ChunkStoreApi` / `EntityManager` / `EntityManagerApi` などが載っているのはそのためである。
タグキーの文字列リテラルまで載るので、キーが動けば API ロックの diff に出る。

### 2-3. `simModule` に型引数を生やすべきか —— **生やすべきでない**

mc-sim は `EntityManagerLayer` を `simModule` に**入れずに**出荷し、判断をホストの配線段に預けた
（`mc-sim/docs/public-api.md` §7-5）。理由は正しい: `simModule` は `const` で、`S` はホストの選択であり、
既定値を出荷することは `BehaviourRepair` の無い `EntityManagerApi<unknown>` を出荷することになる。
そして「どのホストにとっても誤っている既定値は、既定値が無いより悪い」。

本リポジトリはそのホストの隣人であり、実際に配線した結果として**反対側の結論**に達した。
`simModule<S>()` にしても問題は解けず、隠れるだけである。

**1. 型引数がファントムになる。** これが決定的である。

```typescript
const EntityManagerLayer: <S>(initial?, repairBehaviour?) => Layer.Layer<EntityManager>
```

`S` は**戻り値の型のどこにも現れない**。コンテキスト同一性 `EntityManager` は引数を持たないからで、
それ自体は §7-1 の狙いどおりの性質である。しかしその結果、`simModule<S>()` の `S` も戻り値に現れず、
注釈を書かなかった呼び出し側では `unknown` に推論され、**型検査を通ったまま**
`EntityManagerApi<unknown>` のロスタが建つ。§7-5 が「既定値を出荷したときに起きる」と書いた欠陥が、
モジュール契約の形をして戻ってくる。今の形なら、誤った `S` は少なくとも
`EntityManagerLayer<Foo>()` と 1 か所に書き下されている。

**2. `simModule` の型は今のままでも変わらない。** `layers` の型は `Layer.Layer<...>` であり、
`EntityManagerLayer` を merge しても `EntityManager` が 1 つ増えるだけで `S` は入らない。
つまり型引数は**契約を何も強くしない**。破壊的変更（`const` → 関数）を払って得るものが無い。

**3. §4.3 が測ったのは「provide が 2 か所」ではなく「インスタンスが 2 つ」である。**
必要なのは `EntityManagerLayer` の呼び出しが合成ルートに 1 回しか無いことで、それは
`Layer.merge(simModule.layers, EntityManagerLayer<MobBehaviour>(...))` で同じように満たされる。

**では何が防御になるのか。** 型ではなく**名前**である。`S` を名指しできるのは
ルール層のリポジトリだけなので、mx-gameplay が唯一の名前を輸出する:

```typescript
import { gameplayModule, repairMobBehaviour, type MobBehaviour } from '@nerima-games/mx-gameplay'

const world = Layer.merge(
  simModule.layers,
  EntityManagerLayer<MobBehaviour>(undefined, repairMobBehaviour),
)
```

`MobBehaviour` は `CreeperFuse | EndermanFlinch | undefined` の別名であり、Mob が増えれば `|` が
1 本増える（`domain/entities/mob-frame.ts`）。**エンダーマンの追加が実際にその 1 本だった**
——mc-sim 側の変更は 0 行であり、それは `S` が型パラメータであることの意味そのものである。
`repairMobBehaviour` は mc-sim のロード経路が委譲してくる
`BehaviourRepair` で、mc-sim が「知らないと決めた型」を検査できる唯一の場所である。
**この 2 つを `index.ts` から export しているのは、他のすべての export とは違う理由による**
——「テストとプレビューが直接叩くから」ではなく、**ホストが名前で import しなければ正しく配線できないから**である。

残るハザードは正直に書いておく: ホストが `EntityManagerLayer<number>()` と書いても
**どちらのリポジトリのコンパイラも止められない**。`Context.GenericTag` を選んだ以上これは避けられず、
`domain/entity-manager-port.ts` のヘッダに同じ文言で記録してある。

**mx-gameplay 側で `simModule` の型引数が要らなかった証拠**は `RRegister` にある:
`ChunkStore | EntityManager` に `S` は現れない。ホストがどう具体化しても、
本リポジトリが宣言する要求は 1 つのままである（テスト
`the roster requirement carries no behaviour parameter`）。

## 3. 標準 stage 順序と、このリポジトリが埋めるスロット

plan.md §4.2 の骨格:

```
input
  → simulation (physics → interactions → entities → fluids → redstone → time/weather)
  → camera-mirror
  → chunk-sync
  → render
  → post-fx
  → hud-sync
```

| スロット | 所有者 |
| --- | --- |
| `input` | `mc-render` |
| `physics` | `mc-sim` |
| **`interactions`** | **`mx-gameplay`**（`gameplay:interactions`） |
| **`entities`** | **`mx-gameplay`**（`gameplay:entities`） |
| **`fluids`** | **`mx-gameplay`**（`gameplay:fluids`） |
| `redstone` | `mx-redstone` |
| **`time/weather`** | **`mx-gameplay`**（`gameplay:time-weather`） |
| `camera-mirror` | `mc-sim` が正を所有し `mc-render` がミラー（plan.md §3.8） |
| `chunk-sync` | `mc-worldgen` / `mc-render` |
| `render` / `post-fx` | `mc-render` |
| `hud-sync` | `mx-ui` |

**`time/weather` の枠を埋めているのは stage であって、時刻の状態ではない。**
`gameplay:time-weather` はフレーム上の位置を確保しているだけで、時計を進めるのは
`mc-sim` の `TimeService.advance(dt)` である。この stage が育つのは「その時刻の**帰結**」——
天候遷移と、`domain/day-night.ts` の `hostileSpawnsAllowed` を使った敵対 Mob スポーンのゲート——であり、
どちらも mc-sim への書き込みとして適用される（§5 の `domain/day-night.ts` を参照）。

**この骨格そのものは誰も宣言しない。** `mc-compose` が所有する唯一の全順序であり（plan.md §2.3-3）、
この表は「compose がどう解決するはずか」の読み手向けの説明であって、コードのどこにも存在しない。
上の表を `mx-gameplay` の中に定数として書いた瞬間に §2.3-3 違反になる。

なお compose 側の骨格は具体的な id の列ではなく**フェーズ**の列である。
`gameplay:interactions` は「`interactions` フェーズ」に、名前空間ではなく**名前部分**で所属する。
つまり `mx-gameplay` が自分の stage を何と名付けるかは、フレーム上の位置に対して
「どんな仕事か」しか伝えていない——絶対位置は依然として compose だけが言う。

固定しているテストは 2 本ある。

- `` REGRESSION: this repository exposes no way to resolve a total order — only `after` constraints ``
  （`test/stage-registration.test.ts`）— 各 stage のキーが `['after', 'id', 'run']` ちょうどであることを assert する。
  `priority` や `index` を足そうとしたら、ここで止まる。
- `REGRESSION: exports nothing that would let a consumer resolve a total stage order`
  （`test/public-api.test.ts`）— `sortStages` / `stageOrder` / `totalOrder` / `framePipeline` / `runFrame` が
  バレルに現れないことを assert する。前者は registration の形を、後者は**モジュールの表面**を見ている。

## 4. 宣言している `after` が最小である理由

`mx-gameplay` が名指ししている他リポジトリの stage は**1 つだけ**である。

```typescript
export const UPSTREAM_STAGE_IDS = {
  simPhysics: StageId('sim:physics'),
} as const
```

残りの 3 本は自分の中のエッジ（`interactions → entities → fluids → time-weather`）だけを宣言する。

plan.md §4.2 を素直に読むと `input` の後ろでもあり、`redstone` の前でもある。しかし:

- **`input` は冗長。** `input` は `sim:physics` に先行するので、`sim:physics` の後ろにいれば自動的に `input` の後ろにいる。
  冗長なエッジは**全順序についての主張**であり、このリポジトリにはそれを言う資格がない。
- **`redstone` は書けない。** `after: [StageId('redstone:tick')]` は import を作らないので `pnpm check:deps` を通るが、
  `mx-gameplay` のフレーム位置を `mx-redstone` の存在に結びつける（[architecture.md](./architecture.md) §4-3）。
  plan.md §4.2 が `fluids → redstone → time/weather` と並べているのは事実だが、
  **その順序は `mc-compose` が言うことであって、こちらが言うことではない。**

原則: **自分の正しさが要求するものだけ宣言し、残りは compose に渡す。**
`sim:physics` を宣言している理由は自分の正しさに直結する — 移動中にブロックを狙うとき、
統合前の古い座標でレイキャストすると隣のセルを掘る。

なお `after` は「その stage が存在すること」への依存ではない。存在しない stage を名指しした場合は
エッジが無いものとして扱われるので、依存していない相手に対して順序を宣言することは契約上は可能である。
`mx-gameplay` にその必要がないだけである。

## 5. `index.ts` の全 export

**契約** = 他リポジトリが import してよいもの。**内部(可視)** = テストとプレビューのために見えているだけのもの。

`index.ts` は `export *` を 6 本並べているので、内部(可視) も外から見える。
見えることと契約であることは別で、内部(可視) の変更は semver 上 minor 扱いになる（[versioning.md](./versioning.md) §6）。

> **`domain/frame-contract.ts` と `domain/position-key.ts` は re-export していない。**
> どちらも mc-kernel の仮置きであり、削除日が決まっている。バレルから `export *` すると
> `StageId` / `DeltaTimeSecs` / `StageRegistration` が**所有していないパッケージの公開 API** になり、
> 約束されている削除がすべての消費者にとって破壊的変更になってしまう。
> 消費者はこの語彙を kernel から取る。型は構造的に同一なので、kernel から import した消費者は
> 下表の署名に対してそのまま型検査を通る。mc-sim / mc-render / mc-playground-kit のバレルが
> 同じ判断をしており、mx-redstone / mx-ui も同じである。
> 固定しているテスト: `REGRESSION: does not republish mc-kernel’s vocabulary as its own`。

**この一覧は `test/public-api.test.ts` が名前ごと固定している。**
他のテストはすべてモジュールを直接 import しているので、`index.ts` から再エクスポートが 1 本落ちても
1 つも落ちない — それでいて唯一の消費者である `mc-compose` は壊れる。
ただしそのテストは「列挙されているものが全部契約だ」とは言っていない。
バレルを正直に保っているだけで、API を凍結してはいない。

### stages/registration.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `makeGameplayStages` | **契約** | `mc-compose` が消費する唯一の入口。`ChunkStore` を要求する（§2-2） |
| `gameplayStages(state, store)` | 内部(可視) | state と store を外から渡す版。プレビューとテストが state を覗くために使う |
| `makeGameplayFrameState` | 内部(可視) | 再入可能な初期化。テストが 2 つ作って独立性を検査する（DN-GP-6） |
| `GameplayFrameState` | 内部(可視) | フレームローカルの作業メモ（`Ref` 5 本）。ゲーム状態ではない |
| `LAVA_TICK_INTERVAL` | 内部(可視) | 暫定値。プレビューで測って決める |

`Ref` 5 本の内訳は「作業キュー 3 + 受信箱 1 + 送信箱 1」である。

| `Ref` | 何のためか | 判定（セーブファイルに要るか） |
| --- | --- | --- |
| `fallingBlocks` | 落下ブロックのキュー | 要らない。1 フレームで再構成される |
| `fluidFrontier` | 流体のフロンティア | 同上 |
| `tickCount` | 溶岩の tick を刻む | 同上 |
| `pendingBreaks` | **受信箱**。今フレームの破壊要求 | 要らない。セーブが記録するのは「ブロックが無い」ことであって「ボタンが押されていた」ことではない |
| `minedItems` | **送信箱**。掘れたブロックが mc-sim の `InventoryService` に渡るまでの置き場 | 要らない。1 フレーム幅で drain される |

後ろの 2 本は publish されていないサービスの仮置きであり、どちらも消える —
受信箱は mc-render の入力イベントに、送信箱は interactions stage 内の `InventoryService.add` 呼び出しになる。
**送信箱は所有ではない**（何も問い合わせられず、drain されるだけ）ことが、
「1 つの名詞に 2 人の所有者」（DN-GP-7）にならない理由である。
固定しているテスト: `REGRESSION: the frame state holds no time of day and no day length`
（キーの集合をちょうどで検査するので、6 本目は diff で議論になる）、
`REGRESSION: every Ref in the frame state is frame-local scratch, not saved state`。

> **時刻に関する export はここに 1 つも無い。**
> `timeOfDaySecs` / `dayLengthSecs` の `Ref`、`DEFAULT_DAY_LENGTH_SECS`、`advanceTimeOfDay` は
> 削除された。時刻はセーブファイルに要る = **名詞**であり（plan.md §2.3-1）、
> `mc-sim/domain/time-of-day.ts` が `mc-sim/application/time-service.ts` の背後で所有する。
> ここにあった `DEFAULT_DAY_LENGTH_SECS` は 1200 で、mc-sim の 400 と**食い違っていた** —
> 1 つの名詞に 2 人の所有者がいて、セーブされるのは mc-sim の側だけである。
> 固定しているテスト: `REGRESSION: exports no day-length default and no way to advance the clock`
> （`test/public-api.test.ts`）、`REGRESSION: the frame state holds no time of day and no day length`
> （`test/stage-registration.test.ts`）。
> **残ったのはルールのほうである** → `domain/day-night.ts`（下記）。

### domain/day-night.ts（**時刻に対する「ルール」。状態は持たない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `isNight` | 内部(可視) | `timeOfDay < 0.25` または `timeOfDay > 0.75`。**mc-sim の `isNight` と 1 文字違わず同一** |
| `dayPhase` | 内部(可視) | `'night'` / `'dawn'` / `'day'` / `'dusk'` のいずれかを返す。`isNight` と構成的に矛盾しない |
| `hostileSpawnsAllowed` | 内部(可視) | `isNight` の名前付き別名。敵対 Mob スポーンの粗いゲート |
| `DAWN_FRACTION` / `NOON_FRACTION` / `DUSK_FRACTION` | 内部(可視) | 0.25 / 0.5 / 0.75 |
| `TWILIGHT_BAND` | 内部(可視) | 0.05。**演出上の区別であり、スポーン判定には使わない** |
| `DayPhase` | 内部(可視) | 型 |

すべて **1 日の位置（`[0, 1)` の分数）だけを引数に取る全域関数**である。
`Ref` も、既定の日長も、順序制約も持たない。だから `mc-sim` と同期する必要がない。
`timeOfDay` の規約（**0 が真夜中**、0.25 が夜明け、0.5 が正午、0.75 が日没）は
mc-sim が所有する値の規約であり、[mc-sim の public-api.md](https://github.com/nerima-games/mc-sim/blob/main/docs/public-api.md) §2 に書いてある。

これが名詞/動詞ルール（plan.md §2.3-1）の具体例である。
「今何時か」は名詞で mc-sim にあり、「その時刻に世界が何をするか」は動詞でここにある。
分割線は「セーブファイルに要るか」——`timeOfDay` は要る、`isNight(0.9)` は要らない。

固定しているテスト（`test/day-night.test.ts`）:
`exports only functions and plain numbers — no Ref, no factory, no mutable cell`、
`REGRESSION: takes a fraction of the day, so no day length is duplicated here`、
`is the half of the day centred on the 0/1 boundary, exactly as mc-sim computes it`。

### stages/stage-ids.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `GAMEPLAY_STAGE_IDS` | **契約** | 所有する 4 本の id。`mc-compose` が順序表を書くときに名指しする |
| `UPSTREAM_STAGE_IDS` | 内部(可視) | 自分が名指しする他人の stage。レビュー対象として 1 箇所に集めてある |
| `EXPERIENCE_MODULE_STAGE_PREFIXES` | 内部(可視) | 兄弟宛エッジ検査用。テストの資産 |
| `OWN_STAGE_PREFIX` | 内部(可視) | 同上 |

### domain/frame-contract.ts（**kernel の資産のローカル再掲。バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `StageRegistration` | 非公開（所有者は kernel） | plan.md §4.1 逐語。`makeGameplayStages` の**戻り値の形**としてだけ観測される |
| `StageId` / `DeltaTimeSecs`（型 + Brand コンストラクタ） | 非公開（所有者は kernel） | kernel publish 時に import へ差し替え |
| `FrameServices` | 非公開（所有者は kernel） | ここでは `never`。§2 の意図的乖離 |

**`index.ts` はこのファイルから 1 つも re-export しない。**
所有していない語彙を公開 API に載せると、約束済みの削除が破壊的変更に化けるためである（§5 冒頭）。
消費者は同じ型を kernel から取る。構造的に同一なので、`makeGameplayStages` の戻り値は
kernel の `StageRegistration` に対してそのまま代入できる。

### domain/death-cause.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `DeathCause` | 内部(可視) | ローカライズ導入時に `mx-ui` との界面になる候補（[responsibility.md](./responsibility.md) §3-1） |
| `Damage` / `Vitals` | 内部(可視) | `cause` が必須なのが型の全目的（DN-GP-3） |
| `applyDamage` / `isDead` / `deathMessage` / `describeDeath` | 内部(可視) | 体力状態の正は `mc-sim`。ここにあるのはルールの純粋な核 |
| `DEATH_MESSAGES` / `MAX_HEALTH_POINTS` / `fullHealth` | 内部(可視) | |

### domain/mob/creeper-fuse.ts（**Mob AI。状態は持たない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `stepCreeperFuse` | 内部(可視) | `(fuse, senses, dt) => { fuse, explosion }`。**全域・純粋**。`dt` は `DeltaTimeSecs`（brand が `NaN` と負値を構築時に拒否する） |
| `CreeperFuse` | 内部(可視) | `Dormant` / `Lit{burnedSecs}` / `Detonated` のタグ付きユニオン。**`Detonated` は終端** |
| `CreeperSenses` | 内部(可視) | フィールド 1 つ（`distanceToTargetBlocks`）。**このルールがホストに要求する費用の全部**である |
| `CreeperStep` / `DORMANT_FUSE` | 内部(可視) | |
| `CREEPER_IGNITION_RANGE_BLOCKS` / `CREEPER_FUSE_SECS` | 内部(可視) | 3 / 1.5。参照実装 `packages/entity/domain/mob/creeper-fuse.ts:14-15` |

**この 4 型のどこにも Mob の id が無い。** id は名簿への鍵であり、名簿は `mc-sim` の `EntityManager` である
（plan.md §7）。導火線は `domain/death-cause.ts` の `Vitals` と同じ立場の**値**であり、
ホストが持ち、ルールが変換する。

参照実装との意図的な相違が 2 つあり、どちらもファイル冒頭に理由が書いてある。
(1) 状態がユニオンであること（参照実装の `{fuseSecs, ignited}` は 2 つのフィールドが食い違える）、
(2) **爆発が遷移であって述語でないこと**——参照実装は `detonate` フラグを捨てて
（`entity-manager-update-maintenance.ts:36`）保存済みの数値を別ファイルで再判定しており、
「1 回だけ」を担保しているのは 3 つ目のファイルの `HashMap.remove` である。

### domain/mob/explosion.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `explosionDamageAt` | 内部(可視) | **`Damage` を返す。素の数値を返すオーバーロードは無い**（DN-GP-3） |
| `explosionDamageAmount` / `explosionRadius` | 内部(可視) | 参照実装 `explosion-resolution.ts:4,17-23` の逐語移植。半径 = `power * 2` |
| `Explosion` / `ExplosionSource` / `CREEPER_EXPLOSION_POWER` | 内部(可視) | 3。`Explosion` は**座標を持たない**（座標は mc-sim の事実で、ホストが既に持っている） |

**爆発は 2 つの半径を持つ。** ダメージは `power * 2` = 6 ブロック、クレーターは `floor(power)` = 3 ブロック。
クレーターは**未実装**である（ブロックを書くルールなので `ChunkStoreApi` が要り、
`disturb` を呼ばないと砂が宙に浮く。DN-GP-1 が別方向から現れる）。

### domain/mob/hostile-spawn.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `canHostileSpawnAt` | 内部(可視) | 候補セル 1 つに答える全域関数。`Spawn` か `Refused{reason}` |
| `SpawnCandidate` / `SpawnVerdict` / `SpawnRefusal` | 内部(可視) | 理由は**語**で返る。「全部拒否する」と「全部**同じ理由で**拒否する」は別のバグで、後者だけが見つけられる |
| `HOSTILE_SPAWN_MAX_BLOCK_LIGHT` | 内部(可視) | 7。判定は**厳密に大なり**（光度 7 はスポーンする） |
| `MIN_SPAWN_DISTANCE_BLOCKS` / `MAX_SPAWN_DISTANCE_BLOCKS` | 内部(可視) | 16 / 40。**両端とも含む**（参照実装の比較子が非対称で、オラクルだけがそれを言う） |

地面の判定は `domain/chunk-store-port.ts` の `validSpawnSurface`（kernel 能力表のミラー）であり、
**ブロック名の列挙ではない**。参照実装の Mob スポーナはそもそも地面を検査しておらず
（「上から最初の非 air」）、葉とガラスが地面として通っていた。
kernel 監査 §4.9 が `solid` への統合を禁じている理由がその行である。

### domain/mob/mob-drop.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `rollMobDrop` / `rollMobDrops` | 内部(可視) | **ロールは引数**（`[0,1)`）。ドメインに `Math.random()` は 1 つも無く、`test/mob.test.ts` がソース走査で固定する |
| `dropPasses` | 内部(可視) | 参照実装 `drop.ts:14-16` の逐語。比較は厳密 |
| `mobXpReward` | 内部(可視) | XP の**量**はルール、XP の**残高**は mc-sim（plan.md §7） |
| `MobDropRule` / `MobDrop` / `MobKill` / `DropRolls` / `LOWEST_ROLLS` | 内部(可視) | `MobKill` は `Slain{lootingLevel}` か `SelfDestruct` |
| `CREEPER_DROPS` / `CREEPER_XP_REWARD` | 内部(可視) | 火薬 1 個 / 5。`item` の型は **kernel の `ItemType`**（`domain/item-vocabulary.ts` 経由） |
| `GHAST_DROPS` / `GHAST_XP_REWARD` | 内部(可視) | 火薬 1 個 / 5。参照実装 `mobs/ghast.ts:16-17`。**同じ名前を 2 体が共有する**のが語彙の効いている証拠 |
| `BLAZE_DROPS` / `BLAZE_XP_REWARD` | 内部(可視) | `blaze_powder` 1 個・**確率 0.5** / 10。参照実装 `mobs/blaze.ts:17-18`。実在の表で `chance` を使う最初の 1 本 |

**自爆したクリーパーは何も落とさない。** 参照実装ではこれはどこにも書かれておらず、
2 つのファイルの実行順から落ちてくる（`entity-manager-combat.ts:56-64` が
ドロップ経路より先にエンティティを削除する）。挙動は正しく、機構は偶然なので、ここでは引数の場合分けにしてある。

**ブレイズだけ品目が参照実装と違う。** 参照実装は `BLAZE_ROD` を落とすが `blaze_rod` は kernel の
`ItemType` に無く、`blaze_powder` は**「mob drops」という注記つきで kernel が追加したもの**である
（`domain/item-vocabulary.ts` 冒頭が引用している）。**ルール（1 個・0.5）はそのまま、名詞だけが動いた**。
逆に**エンダーマンとシュルカーのドロップ表はここに無い** —— `ender_pearl` / `shulker_shell` は
`ItemType` に無く、綴れる名前で代用するのは別のルールを書くことだからである。kernel の表に 1 行増えれば
このリポジトリの編集は 0 行で済む（`domain/mob/hostile-spawn.ts` がブロック名について言っているのと同じ話）。

### domain/mob/enderman-teleport.ts（**位置を持たないテレポート**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `endermanTeleportUrge` | 内部(可視) | `Stay` か `Teleport{reason, anchor}`。**被弾分岐は短絡する**（被弾してロールに失敗したら、40 フレーム動けていなくても動かない） |
| `endermanTeleportOffset` | 内部(可視) | 16 回まで試して**最初に 8..32 ブロックに入った変位**を返す。ロールが尽きたら探索終了 |
| `TeleportOffset` | 内部(可視) | `{xBlocks, zBlocks}`。**`y` が無い** |
| `TeleportAnchor` / `TeleportReason` / `EndermanTeleportUrge` / `EndermanSenses` | 内部(可視) | `anchor` は `'self'`（逃走）か `'target'`（接近） |
| `ENDERMAN_TELEPORT_MIN_BLOCKS` / `..._MAX_BLOCKS` / `..._ATTEMPTS` | 内部(可視) | 8 / 32 / 16。両端とも含む |
| `ENDERMAN_DAMAGE_TELEPORT_CHANCE` / `..._CHASE_...` / `..._STUCK_TELEPORT_TICKS` | 内部(可視) | 0.3 / 0.05 / 40。最後だけ**秒でなくフレーム**で、それは参照実装のものである |

**座標が消えるのは発見であって妥協ではない。** 参照実装の `computeEndermanTeleportTarget` は
第 1 引数（エンダーマン自身の位置）を使っておらず（`enderman-teleport.ts:28` の `_position`）、
候補を `targetPosition + offset` で作って**その `targetPosition` に対して**距離を検査している（:37-43）ので、
検査している距離は生成した変位の大きさそのものである。位置は約分される。残るのが**変位**であり、
それがこのファイルである。参照実装のオラクルの期待値 `{x:116, y:64, z:-20}` は、
アンカー `{x:100,…}` にこのファイルの `{xBlocks:16, zBlocks:0}` を足した値に桁まで一致する。

**アンカーが答えの一部なのは、参照実装がそこで静かに間違えるからである。** 呼び出しは 2 箇所あり、
被弾側は自分の位置（`entity-manager-damage-enderman.ts:16-18`＝逃走）、追跡側は**プレイヤーの位置**
（`entity-manager-ai-enderman-teleport.ts:30-34`＝どれだけ離れていても 8..32 まで詰める接近）を渡す。
両者が別物であることはどこにも記録されていない —— それを決めている引数が、関数が無視している引数だからである。

### domain/mob/shulker-shell.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `stepShulkerShell` | 内部(可視) | `(shell, senses) => { shell, canFire }`。全域・純粋 |
| `ShulkerShell` | 内部(可視) | `Closed` / `Opening{openedTicks}` / `Open`。**カウンタは `Opening` の中にある**（参照実装は入力で受けて返さないので、ホストがリセットを忘れられる） |
| `shulkerShellArmorPoints` | 内部(可視) | 閉 20 / それ以外 0。**軽減後のダメージではなく点数**を返す |
| `shulkerWantsToTeleport` | 内部(可視) | 「殻を閉じる」条件と**同一の関数**。参照実装は同じ式を 2 度書いていて、一致する保証が無い |
| `SHULKER_OPENING_TICKS` / `SHULKER_CLOSED_ARMOR_POINTS` / `CLOSED_SHELL` / `ShulkerSenses` / `ShulkerStep` | 内部(可視) | 20 / 20 |

**参照実装のこの一群は、テスト以外のどこからも呼ばれていない。** スポーン輪番にシュルカーは居らず
（`mob-categories.ts:16-25`）、殻を進めるレーンも無い。だから矛盾が 2 つ生き残っている:
(1) `tickShulkerShell` は閉殻を `isInvulnerable: true` と言い、同じファイルの `computeShulkerShellDamage` は
20% を通す（20 点＝80% 減、`combat.config.ts:15-16`）。**移植したのは点数のほうで、フラグは捨てた** ——
先に読んだ呼び出し側が勝つ設計で、片方は Mob を不死にする。
(2) `SHULKER_FORCED_CLOSED_TICKS = 100` はどこからも参照されておらず、それが門番をする
`closeTicksRemaining` には生産者も減算もない。**移植しない**（両端とも発明することになる）。

### domain/mob/hostile-despawn.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `despawnVerdict` | 内部(可視) | `Keep` か `Despawn{reason}`。**判定順は参照実装のもの**で、有限性検査が persistent 免除より**先**に走る |
| `DespawnCandidate` / `DespawnVerdict` / `DespawnReason` | 内部(可視) | `persistent` は**旗**であって Mob 名ではない（参照実装は `type === 'Villager'` と書いている） |
| `DESPAWN_DISTANCE_BLOCKS` | 内部(可視) | 128。**3D**で測る（スポーン帯は XZ のみ）。比較は厳密に大なりで、128 ちょうどは残る |

**スポーン規則と掃除規則は逆向きに倒れ、それが 1 つの設計である。** 測れない候補を `hostile-spawn` は
`Refused` と答え、測れない Mob をこちらは `Despawn` と答える。**どちらも Mob を減らす**ので、
壊れた測定値が個体数を増やす理由になることは無い。

**時間による despawn は無い。** vanilla は距離と時間の両方で消すが、参照実装は距離だけで、
エンティティに年齢が無い。docs/porting.md §4 に従って**足していない** —— 年齢は mc-sim の名簿の欄であり、
ランダム despawn のロールは引数で渡してもらうものだからである（アリーナの missing 一覧に行き先つきで載っている）。

### domain/falling-block.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `disturb` / `takeBatch` / `settled` | 内部(可視) | **「世界を走査する」関数が存在しないこと**が API の要点（DN-GP-1） |
| `FallingBlockQueue` / `FallingBlockBatch` / `emptyFallingBlockQueue` | 内部(可視) | |
| `FALLING_BLOCK_MOVES_PER_TICK` | 内部(可視) | 32。参照実装の `FALLING_BLOCK_MAX_PER_TICK` と同値 |

### domain/fluid-frontier.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `splitBudget` / `carryOver` | 内部(可視) | 2 つに分けてあるのが要点（DN-GP-2） |
| `FluidKind` / `FluidWorkItem` / `FluidBudgetSplit` | 内部(可視) | |
| `DEFAULT_FLUID_FRONTIER_BUDGET` | 内部(可視) | 64。暫定値 |

### domain/interactions/break-block.ts（**バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `breakBlock` / `BreakOutcome` | 非公開 | 1 ルール 1 ファイル（DN-GP-9）の 1 本目。`setBlock` を 1 回呼ぶだけで、**read-then-write をしない** — 掘れたブロックは書き込みの戻り値 `previous` から来る |

`BreakOutcome` は `BlockWriteOutcome` と同じく全域である。`NothingThere`（= `Unchanged`）は
アイテムを生まず、チャンクを汚さず、落下ブロックの仕事も作らない。
固定しているテスト: `` REGRESSION: breaking air is `Unchanged` — no item, no dirty chunk, no falling-block work ``。

### domain/entities/falling-block-move.ts（**バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `applyFallingBlocks` / `FallingBlockMoves` | 非公開 | `domain/falling-block.ts` が**予定**、こちらが**移動**。走査もダーティチャンネルの購読もしない（DN-GP-1 / DN-GP-11） |

### domain/block-position-key.ts（**バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `positionKeyOf` / `positionOfKey` / `above` / `below` | 非公開 | **プレースホルダ。** `PositionKey`（予定の語彙）と `BlockPosition`（世界の語彙）の唯一の接続点。エンコードを 1 箇所に閉じてあるのは、参照実装のように呼び出しごとに `${x},${y},${z}` と書くと、所有者のいないワイヤフォーマットができるからである |

### domain/chunk-store-port.ts（**バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `ChunkStore` / `ChunkStoreApi` / `BlockReading` / `BlockWriteOutcome` / … | 非公開（所有者は mc-worldgen） | mc-worldgen のサービスのミラー。**狭いミラーは静かな実行時ハザード**なので API 全体を写してある。`test/chunk-store-mirror.test.ts` がタグキーと形の両方を固定する |
| `fallsWhenUnsupported` / `isReplaceable` / `AIR_BLOCK_ID` | 非公開（所有者は kernel） | 能力表の再掲。ルールは**ブロックを名指ししない** — バイトを読んで表に尋ねる |

`makeGameplayStages` の型に `ChunkStore` が現れるため、このファイルは re-export していなくても
`api-lock.md` の "Supporting declarations" には載る（§2-2）。

### domain/item-vocabulary.ts（**バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `ITEM_TYPES` / `ItemType` | 非公開（所有者は kernel） | kernel `domain/item-type.ts` のミラー。`gunpowder` / `blaze_powder` は「Mob ドロップ。**ルールは mx-gameplay、語彙は kernel**」という注記つきで kernel の名簿に入った literal である |

ロスタ全体を写してあるのは、**部分ミラーは機械比較できない**からである
（`mc-dev-meta` の `pnpm check:mirrors` が `REPLACEABLE_IDS` の `lava` 欠落を見つけたのは集合ごと差分を取ったため）。
kernel が literal を**足す**分にはこちらが stale になるだけで壊れず、
こちらが名指ししている literal を kernel が**消した**ときだけ削除日に壊れる —— それは壊れるべき日である。
固定しているテスト: `REGRESSION: does not republish mc-kernel’s vocabulary as its own`。

### domain/position-key.ts（**バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `PositionKey` | 非公開 | **プレースホルダ。** 座標語彙は kernel の所有物なので、意図的に brand していない。`frame-contract.ts` と同じ理由でバレルには載せない |

### domain/entities/mob-frame.ts（**接合部。`domain/mob/` は 1 行も変わっていない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `MobBehaviour` | **契約に近い** | mc-sim の `S` の具体化。`CreeperFuse \| EndermanFlinch \| undefined`。**ホストが名前で import する必要がある**（§2-3） |
| `repairMobBehaviour` | **契約に近い** | mc-sim の `BehaviourRepair`。ロード経路が委譲してくる、全域かつ不動点の修復（§2-3）。kind ごとに腕があり、**形の合わない behaviour は信用せず差し替える** |
| `EndermanFlinch` / `STEADY_ENDERMAN` / `STRUCK_ENDERMAN` | 内部(可視) | 「直前に殴られたか」だけを持つ 2 タグの union。フィールドが無いので save が壊せる数値も無い。`resolveBlasts` が立て、次の `sweepMobs` が**決定に関わらず消費する**（殴打は 1 フレームのもの） |
| `CREEPER_KIND` / `ENDERMAN_KIND` | 内部(可視) | 本リポジトリが `EntityKind` を名指しする**唯一の場所**。mc-sim は kind で分岐しない（DN-11）ので綴りを誰も検査しない。`ENDERMAN_KIND` を**スポーンさせるものはまだ無い**（`MobSpawnAttempt` に kind が無く、上限が kind ごとのままだから）ので、到達経路は host の `spawn` とロード経路である |
| `CREEPER_MAX_HEALTH` / `MAX_HOSTILE_COUNT` | 内部(可視) | kind ごとの定数はルール層のもの（mc-sim §7-6）。`MAX_HOSTILE_COUNT` は `hostile-spawn.ts` が「mc-sim と一緒に到着する」と書いていた数 |
| `ENDERMAN_TELEPORT_ROLLS` | 内部(可視) | テレポート 1 回が引くロール数（16 試行 × 2）。**当たった試行数ではなく固定の予算を引く**ので、種の進み方は「テレポートしたか」だけに依存する |
| `MobSweep` | 内部(可視) | `sweepMobs` の戻り値。`{ blasts, seed }` ——エンダーマンがロールを引くので、種は sweep を**通り抜ける** |
| `sweepMobs` / `resolveBlasts` / `applySpawnAttempts` | 内部(可視) | 1 フレーム＝ 2 sweep（ルールと爆風）＋ 候補ごとの spawn。ルールの選択は **behaviour のタグ**、その保証は **kind** ——両方要る。ルールの無い Mob は**共有された 1 個の `EntityStep`** を受け取る |
| `rollCasualtyDrops` / `rollSelfDestructDrops` / `rollDropsOfKind` / `dropRulesOfKind` / `dropRollsNeeded` | 内部(可視) | ドロップ表は kind → ルールの表。自爆が何も落とさないのは**ルールに訊いた結果**であって stage の仮定ではない |
| `distanceBetween` / `cellOf` | 内部(可視) | 測定。`Position`（連続）から `BlockPosition`（セル）へは `Math.floor` であって `Math.round` ではない |
| `Blast` / `MobCasualty` / `MobFrameSenses` / `BlastResolution` / `CasualtyDrops` / `MobSpawnAttempt` / `MobSpawnOutcome` | 内部(可視) | |

`Blast` が位置を持つのは、`domain/mob/explosion.ts` の `Explosion` が**意図的に持たない**からである
——「座標はホストの事実」であり、ここがそのホストである。

### domain/frame-rolls.ts（**フレームに乱数が入る唯一の場所**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `nextRoll` / `drawRolls` / `normaliseSeed` | 内部(可視) | Lehmer/Park-Miller MINSTD。すべての中間値が double で厳密なのでエンジンに依らず同じ列になる |
| `DEFAULT_ROLL_SEED` / `RollDraw` / `RollBatch` | 内部(可視) | **literal であって時刻ではない**。同じシナリオの 2 回の実行が同じ数を引く（plan.md §5.1-3） |

`Math.random()` でも `Effect.Random` でも mc-sim のエンティティ上の生成器でもない理由は
ファイルヘッダに 4 行の表で書いてある。要点は `run` の文脈が kernel の `FrameServices`（今は `never`）であり、
そこに乱数サービスを要求することは kernel に 1.0.0 で凍結したい別名を広げさせることになる、というものである。
固定しているテスト: `` REGRESSION-PROOF BY SHAPE: nothing on the frame path reads a random number or a clock ``。

### domain/interactions/explosion-crater.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `craterRadius` / `craterCells` / `carveExplosionCrater` | 内部(可視) | **爆発の「もう一方の半径」**。ダメージは `power * 2` = 6、破壊は `floor(power)` = 3 |

`explosion.ts` が「クレーターはここではない。`ChunkStoreApi` を持つ `interactions/` の隣であり、
`disturb` に食わせなければ砂漠の下の爆発は砂を宙に残す」と書いた行き先そのものである。
`Written` になったセルだけを返すので、**空中の爆発はキューに何も入れない**。

### domain/entity-manager-port.ts（**バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `EntityManagerApi` / `EntityManager` / `entityManagerTag` / `ENTITY_MANAGER_TAG_KEY` | 非公開（所有者は mc-sim） | mc-sim `application/entity-manager.ts` のミラー。**全 11 メンバを写す**（狭いミラーは実行時ハザード） |
| `Entity` / `EntityState` / `EntityRoster` / `EntityTransition` / `EntityStep` / `SpawnRequest` / `RosterRepair` / `BehaviourRepair` | 非公開（所有者は mc-sim） | |
| `EntityId` / `EntityKind` | 非公開（所有者は mc-sim） | brand の refinement は**文字単位で転記**。brand は文字列で同一視されるので、緩い/厳しいミラーは mc-physics の `DeltaTimeSecs` 欠陥そのものになる |
| `Position` | 非公開（所有者は kernel、2 ホップ） | `chunk-store-port.ts` の `BlockPosition` とは**別型**。連続点とセルは違う概念で、どちらの所有者も等価だと宣言していない |
| `UNCHANGED` / `DESPAWNED` / `changed` | 非公開（所有者は mc-sim） | 共有定数。無風フレームが transition を 1 つも作らないための仕掛け |

`ChunkStore` と違い `EntityManager` は `Context.Tag` クラスではなく**構造的な型**なので、
公称の食い違いは起こり得ない（構造が同じなら同じ型である）。残るのは**キー**と**欠けたメンバ**で、
`test/entity-manager-mirror.test.ts` が両方を固定している。
mc-sim の**純粋関数**（`spawnEntity` / `sweepRoster` / `normaliseRoster` …）は写していない
——タグを持たないので、欠けていれば呼び出し側でコンパイルエラーになるだけで、`undefined` にはならない。

### domain/vehicle/rail-shape.ts（**レールのトポロジ。速度も名簿も持たない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `resolveRailShape` | 内部(可視) | 周囲 4 方向のレールから形を決める全域関数。**import が 1 本も無い。** 最大 12 回、注入された述語を呼ぶだけで、`ChunkStoreApi` を名指さない |
| `RailShape` | 内部(可視) | `'ns'` / `'ew'` / `'curve'` / `'isolated'`。`'isolated'` は「分からない」ではなく「**何も拘束しない**」である |
| `IsRailAt` | 内部(可視) | `(wx, wy, wz) => boolean`。**注入される述語**で、`mc-physics` の `IsBlockSolid` と同じ形。ブロック ID を名指さずに済ませる仕掛けそのもので、呼び出し側は kernel の `railKind` から作る（plan.md §3.4） |

### domain/vehicle/rail-ascent.ts

| export | 種別 | 備考 |
| --- | --- | --- |
| `isAscendingAhead` | 内部(可視) | 向きの先・1 ブロック上にレールがあるか。**`isRailAt` をちょうど 1 回**呼ぶ。速度の形をした引数を取るが**大きさは答えに届かない**（[responsibility.md](./responsibility.md) §5-1。`test/rail.test.ts` が正の定数倍で固定） |
| `RAIL_HEADING_EPSILON` | 内部(可視) | `1e-9`。**転記であって正当化ではない**ことを定数の doc comment に明記してある。参照実装 `rail-shape.ts:74` に測定は無い |

> **`projectMinecartVelocity` と `RAIL_CLIMB_SPEED` はここに無い。** どちらも所有権としては
> このリポジトリのものだが、消費者（＝速度を持つ乗り物）が `mc-sim` にまだ無い。
> 判断は [responsibility.md](./responsibility.md) §5 が唯一の記述で、§6 の基準に照らせば
> **昇格どころか実装がまだ早い**側である。

## 6. 契約を足すときの基準

`makeGameplayStages` 以外を「契約」に昇格させてよいのは、
**他リポジトリが実際にそれを import する必要があると判明したとき**だけである。

そして、そう判明したときにまず疑うべきは昇格ではなく配置である。
他リポジトリが `mx-gameplay` の何かを欲しがっているなら、それはたいてい状態であり、
`mc-sim` か `mc-worldgen` に置くのが正しい（[responsibility.md](./responsibility.md) §3）。
`mx-gameplay` に第 2 の公開界面が生えるのは、名詞/動詞の線がずれた徴候である。

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
export const makeGameplayStages: Effect.Effect<ReadonlyArray<StageRegistration>>

export const gameplayModule: GameModule<never, never, never> = {
  layers: Layer.empty,
  frameStages: makeGameplayStages,
}
```

`RIn` は `never` のままである。mx-gameplay が mc-sim のサービス越しに書き込みを始めるとき、
それらは `frameStages` の中で — つまり `RRegister` パラメータで — 取得される。
本リポジトリは mc-sim が供給しなければならないものを**構築**するのではなく、
mc-sim が供給するものを**呼ぶ**だけだからである。

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
| `makeGameplayStages` | **契約** | `mc-compose` が消費する唯一の入口 |
| `gameplayStages(state)` | 内部(可視) | state を外から渡す版。プレビューとテストが state を覗くために使う |
| `makeGameplayFrameState` | 内部(可視) | 再入可能な初期化。テストが 2 つ作って独立性を検査する（DN-GP-6） |
| `GameplayFrameState` | 内部(可視) | フレームローカルの作業メモ（`Ref` 3 本）。ゲーム状態ではない |
| `LAVA_TICK_INTERVAL` | 内部(可視) | 暫定値。プレビューで測って決める |

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

### domain/position-key.ts（**バレルから re-export しない**）

| export | 種別 | 備考 |
| --- | --- | --- |
| `PositionKey` | 非公開 | **プレースホルダ。** 座標語彙は kernel の所有物なので、意図的に brand していない。`frame-contract.ts` と同じ理由でバレルには載せない |

## 6. 契約を足すときの基準

`makeGameplayStages` 以外を「契約」に昇格させてよいのは、
**他リポジトリが実際にそれを import する必要があると判明したとき**だけである。

そして、そう判明したときにまず疑うべきは昇格ではなく配置である。
他リポジトリが `mx-gameplay` の何かを欲しがっているなら、それはたいてい状態であり、
`mc-sim` か `mc-worldgen` に置くのが正しい（[responsibility.md](./responsibility.md) §3）。
`mx-gameplay` に第 2 の公開界面が生えるのは、名詞/動詞の線がずれた徴候である。

# 検証とテスト

## 1. 検証要件

plan.md §3.11:

> **検証**: ルール単位のシナリオテスト + **プレビュー3本**（採掘場: 掘る/置く/ドロップ確認、
> Mobアリーナ: スポーンさせて対峙、時間スライダー: 昼夜/天候）

**テストだけでは完成にならない。** 各リポジトリが単独で正しさを閉じるという構成の前提が
「テスト green + プレビューで目視確認済み」（plan.md §1）だからである。

### 1-1. 4 つのゲート

`pnpm verify` = `typecheck && lint && check:deps && api:check && test`。CI（`.github/workflows/ci.yaml`）と同じ内容。

**`pnpm preview` はここに入らない。** プレビューは完成条件（§3）であってゲートではない。
型検査（`tsconfig.preview.json`）と lint は掛かるが、CI がプレビューを**実行**することはない。

| ゲート | コマンド | 何を捕まえるか |
| --- | --- | --- |
| 型 | `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト + スクリプト）と `tsconfig.preview.json`（`apps/`）の**3 つ**。前者は `types: []` / `lib: ["ES2024"]` なので、Node 型や DOM 型が出荷ソースに漏れた時点で落ちる |
| lint | `pnpm lint` | oxlint。`index.ts domain stages scripts test apps` の 46 ファイル。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| 境界 | `pnpm check:deps` | 依存ホワイトリスト / 循環 / 推移閉包 / kit の実行時混入 / `Date.now()` |
| 振る舞い | `pnpm test` | vitest |

**このリポジトリで最も重要なのは 3 番目**である。型検査も lint も、
`import … from '@nerima-games/mx-ui'` を止められない。止めるのは `check:deps` だけである
（[architecture.md](./architecture.md) §4-3）。

**oxlint がこのリポジトリ唯一の lint / format 設定である。**
prettier も biome も `.editorconfig` も置かない。整形の権威が 2 つあると
「どちらが正か」の議論が発生し、CI が 2 回走る。

**oxlint 自体は `package.json` の devDependency ではなく、`flake.nix` の devShell から供給される。**
以前は各リポジトリが `package.json` に独自バージョンを固定しており、`no-restricted-imports` を
実装していない oxlint 0.12.x に気づかず滞留する例があった。nixpkgs 由来の単一バージョンに
統一することでこの drift を無くしている。CI（`.github/workflows/ci.yaml`）も
`nix develop --command pnpm lint` で実行する。

### 1-2. 型検査を 2 回走らせている理由

`tsconfig.build.json` は `test/**` と `scripts/**` を除外する。**除外はここにしかない。**
これが「`mc-playground-kit` は devDependency である」に実効性を与えている —
プレビューハーネスは kit に手を伸ばしてよく、出荷ルールは伸ばしてはいけない（plan.md §2.3-2）。

`tsconfig.test.json` は `types: ["node"]` を足す。**足すのはここだけ**である。
参照実装と違い、テスト向けに strictness フラグを緩めることは一切していない
（`tsconfig.test.json` のコメント: "test code is code, and a skeleton has no legacy to grandfather"）。

## 2. 現在のスイート

**27 ファイル / 660 テスト、全 pass。**（`pnpm test` の出力。
**この行は 19 / 440 と書かれたまま古くなっていた** —— 実測すると直前で既に 24 / 541 で、
弓とエンダーパール（§3-1 の 1 行目）で 2 ファイル / 99 本が増えて 26 / 640 になり、
`interaction-*` の**新規 4 本**（§2-2-1、porting.md §4-4）で 644、
ポータルの滞留タイマー（`test/portal-dwell.test.ts`、別作業）で 1 ファイル / 16 本が増えて **660** である。
状態表が実装より古くなるのはこの文書が自分で主要な失敗様式として挙げているもので、
**この行自身がその 3 例目**である。以前この行は 16 / 373 と書いていた ——
99% ゲートを入れるにあたって 2 ファイルと 36 本が増え、[porting.md](./porting.md) §4-3 の
移植 2 回目でさらに 6 本増え、レールのトポロジ（§3-1 の 5 行目）で
`test/rail.test.ts` 1 ファイル / 25 本が増えた。ゲート導入分の内訳と、そのうち何本が
「数字のため」ではなかったかは §4 にある）

| ファイル | 本数 | 内容 |
| --- | ---: | --- |
| `test/api-lock.test.ts` | 26 | API ロック生成器そのもの（`scripts/api-lock.ts`） |
| `test/rules.test.ts` | 21 | DN-GP-1 / DN-GP-2 / DN-GP-3 のドメイン単体。流体の予算配分は参照実装の `fluid-tick-budget.test.ts` から 2 本を追加（溶岩は**残り**を取る／有効な lava tick は retain しない）。同ファイルの空入力ケースを**反証できないので消した**理由もここにコメントで残っている |
| `test/mob.test.ts` | 75 | **クリーパー / エンダーマン / シュルカー / 掃除。** 導火線と殻の状態機械を**列挙**し（両方とも全遷移を通す）、爆風の減衰表・スポーン判定・ドロップ・テレポート帯・デスポーン距離を参照実装のオラクルから移植する（§2-2）。乱数がドメインに無いことをソース走査で固定する 1 本と、シナリオ再現を 2 本含む |
| `test/stage-registration.test.ts` | 24 | フレーム契約（§2.3-1 / §2.3-3）と stage の振る舞い。時刻の `Ref` が無いこと、store・名簿・**インベントリ**の 3 つを**登録時に**取ること。kernel から写した 2 つのブランド（`DeltaTimeSecs` / `StackCount`）の精製もここで固定する —— ブランドは**文字列で同一視される**ので、精製がずれたミラーはコンパイラが決して反証できない偽の保証になる |
| `test/check-dependency-whitelist.test.ts` | 18 | 依存ポリシーそのもの。うち 3 本は**他リポジトリの席から**読んだ roster 検査（§2-3） |
| `test/vertical-slice.test.ts` | 42 | 縦切り。**stage 登録経由で**「掘る → 砂が落ちる → アイテムが渡る」「掘る → 置く → 落ちる」「クリーパーが湧く → 爆ぜる → ドロップ」を回す（DN-GP-1 / DN-GP-11）。砂が**水**を、砂利が**溶岩**を貫いて沈む 2 本は参照実装の `falling-block.test.ts:132-152` から。溶岩側は `REPLACEABLE_IDS` の欠落した行の**もう半分**で、これまで何も固定していなかった |
| `test/day-night.test.ts` | 8 | DN-GP-7。昼夜**ルール**が何も保持していないこと、mc-sim と夜の定義が一致すること |
| `test/public-api.test.ts` | 8 | `index.ts` のバレルを名前ごと固定する。kernel 語彙と時刻 API の**不在**も固定する |
| `test/block-vocabulary-mirror.test.ts` | 13 | kernel 語彙のミラー。4 つの能力述語に加え、**`supportRule` の 19 行 override 表を全数**固定する（部分ミラーは別の型なので）。ミラーは転記を固定するだけで、源との比較は mc-dev-meta の `pnpm check:mirrors` である |
| `test/chunk-store-mirror.test.ts` | 6 | `domain/chunk-store-port.ts` を mc-worldgen の界面に**両方向で**固定する。タグキーは文字どおり検査する。`validSpawnSurface` が**負リスト**であること（＝既定 true）もここ（**この行は 7 と書かれたまま古くなっていた。実測 6**） |
| `test/preview-findings.test.ts` | 10 | **プレビューが見つけたもの**（§3-4）。うち 8 本は「現在の（誤った）挙動を固定する」テストで、直すと落ちる。**F7 はここではなく `test/place-block.test.ts` にある** —— プレビューではなく移植が見つけたものだから（§3-5）。F7 は**解決済み**で、8 本のうちの 1 つの前例になった：直したときテストは消さず、同じ参照行との**一致**へ書き換える（§3-5-1） |
| `test/entity-manager-mirror.test.ts` | 15 | `domain/entity-manager-port.ts` を mc-sim の界面に固定する |
| `test/inventory-mirror.test.ts` | 11 | `domain/inventory-port.ts` を mc-sim の界面に固定する。**このリポジトリで最も広いミラー** —— `InventoryServiceApi` 全体に加え、api が名指しする `Inventory` / `RecipeTable` / `CraftGrid` / `RecipeMatch` / `CraftResult` とその下の語彙 16 型を**両方向**で突き合わせる。**型の一致だけでは足りない 1 点**も入っている: `add` は「**入らなかった数**」を返し `remove` は「**実際に取れた数**」を返すので、両者は `(item, count) => Effect<number>` として区別がつかない。極性は double に対する**振る舞い**で固定してある |
| `test/player-mirror.test.ts` | 15 | `domain/player-port.ts` を mc-sim の界面に固定する。**呼び手が 1 人も居ない唯一のミラー**なので、他の 3 本と違って**第 2 の防御線が無い** —— `ChunkStore` や `InventoryService` は stage が呼ぶからずれれば別のテストが落ちるが、こちらは このファイルだけが持っている。両方向の代入と `PlayerPose`（`feetPosition` の綴り）と鍵の literal に加え、**`check:mirrors` が構造的に見られない 1 点**を持つ: `cameraPose` の `R` チャンネル（`ClockPort`）。`type-shape.ts` はメンバの**名前と optional 性だけ**を比べるので、`Effect<CameraPoseSnapshot>` に狭めたミラーはあのゲートを通って repoint 日にコンパイラで落ちる。ついでに `frame-contract.ts` に来た `ClockPort` の鍵・`ClockService` の 2 メンバ・`MonotonicTimeSecs` / `EpochMillis` の精製と**文言**もここで固定する（文言は転記であって選択ではない） |
| `test/mob-spawn-search.test.ts` | 27 | `domain/entities/mob-spawn-search.ts` のリングと、その 256 回のストア呼び出し。参照実装の `mob-spawner-helpers.test.ts:6-13` から**リングが一周すること**、`mob-spawner-rules.test.ts:18-20` から**3D でも掃除距離の内側**であること（porting.md §4-3）。前者は半周リングという変異が 409 本を 1 つも落とさなかったので足した |
| `test/place-block.test.ts` | 56 | **設置**（§3-1 の 1 行目）。参照実装が**実際に間違えた 3 点**を `REGRESSION:` として持つ —— 溶岩は replaceable、自分の体の中には置けない、支えが要るブロックは支えを見る。`blockOverlapsPlayer` の境界表（`block-service-utils.test.ts:84-98`）は**そのまま移植**してあり、参照実装が同じ関数に持っている**第 2 の表**（`block-utils.test.ts:88-121`、y 軸の排他境界と対角）も移植した。`block-support.test.ts` の支持表は**全行**移植済み —— fallback アームの行と、`SUPPORT_RULES` の行（旧 F7、§3-5-1 で解決）の両方 |
| `test/block-loot.test.ts` | 32 | **ブロックのドロップテーブル**（§3-1 の 3 行目）。kernel の表を通る決定論的な半分と、audit §6-9 がこちらに置いた乱数の半分（fortune / 葉のボーナス）。「素手で石を掘っても何も出ない」が**見た目では気付けないほうの半分**である。ボーナス 4 率（りんご 1/200・棒 2%・苗木 5%・種 1/8）は参照実装から移植 —— **うち 3 つは今日どの表にも載っていない**が、待っているのは kernel の roster 行であって発明ではない。道具の段は `harvestable-blocks.test.ts` の**真の包含鎖**と `block-utils.test.ts` の**段ごとの 4 行**を移植（porting.md §4-3。後者は §4-2 が roster ギャップで断っていたもので、kernel の roster 完成で**期限切れになった拒否**である）。**F8** —— シルクタッチが置換ではなく関門であるという参照実装との乖離 —— の pin もここ（§3-6） |
| `test/weather.test.ts` | 25 | **天候**（§3-1 の 7 行目）。参照実装の `packages/game/test/weather.test.ts` の 8 本を**値を変えずに**移植し、`weather-service.test.ts:89-113` の**3 連続遷移**（保持している天候から選ぶこと）も移植する（porting.md §4-3）。そのうえで参照実装には書けないテスト —— 2 時間ぶんのフレームを回して遷移グラフを歩き、**2 回走らせて同じ列になる**こと（§5 の fast-forward）を足す。fast-forward は「2 回が一致する」しか見ないので、**間違った歩き方も同じくらいよく再現する** —— 3 連続遷移はそこを埋める |
| `test/bow.test.ts` | 70 | **弓**（§3-1 の 1 行目）。参照実装の `bow-resolution.test.ts` の 13 本を**値を変えずに**移植し、そのうえで参照実装が記録していないものを足す —— クロスヘアの円柱の境界、**後ろは撃てないこと**（`alongRay < 0` の半分。落とすと弓が背後を撃つ）、同距離 2 体の**どちらが当たるか**、そして**向きを正の定数倍しても答えが変わらないこと**（responsibility.md §7-3 の所有権論をテストにしたもの。`test/rail.test.ts` と同じ形）。参照実装との**乖離を 4 つ**明記して固定する: 負・無限のチャージ、退化した照準（参照実装は近くの mob に当たる）、ノックバックのデッドバンド、そして Power の**レベル 0 で 1.25 倍にならない**こと。**遮蔽の歩きが標本化であって走査ではない**という限界も、角を抜けるテストとして固定してある —— DDA が来た日に赤くなる |
| `test/ender-pearl.test.ts` | 29 | **エンダーパール**（§3-1 の 1 行目）。参照実装の `ender-pearl.test.ts` の距離・確率の判定を移植し、**下限 `roll >= 0` が本当に働いていること**（外すと壊れた生成器から毎回エンダーマイトが湧く）を足す。乖離は 2 つ —— 退化した照準（参照実装は**真北に 24 ブロック**飛ぶ）と、非有限の hit 距離（参照実装は `NaN` 位置へテレポートし、プレイヤーを世界から失う）。後半 6 本は**配線**で、stage 経由でパールを投げ、エンダーマイトが**着地点に**湧くこと、feet が無ければ湧かないが移動と自傷は起きること、**同じシナリオを 2 回走らせて同じ列になる**ことを回す |
| `test/frame-rolls.test.ts` | 9 | **乱数がフレームに入る場所**（`domain/frame-rolls.ts`）。他のテストは全部 stage 経由で回すので、**生成器が作っていない**シードやカウントについては何も言えていなかった —— 0 が生成器の不動点であること、カウント 0 が種を動かさないこと、`rollAt` が末尾より先を 0 と読むこと。3 つとも本文が主張していて誰も確かめていなかった |
| `test/mob-frame.test.ts` | 9 | `domain/entities/mob-frame.ts` の**フレーム層**。ルール（`domain/mob/`）は `mob.test.ts`、配線は `vertical-slice.test.ts` が持っており、その間が空いていた —— **外した**爆風、爆風ゼロ本のフレームの費用、爆風を生き延びたクリーパーが導火線を保つこと |
| `test/rail.test.ts` | 25 | **レールのトポロジ**（§3-1 の 5 行目）。参照実装の `rail-shape.test.ts` の 10 本のうち、**この責務に属する 7 本を転記**し、残る 3 本は `projectMinecartVelocity` として今は実装済み。そこに加えて参照実装のオラクルが見ていないものを足す —— 近傍 4 方向の**16 通り全数**（曲線が直線に勝つこと）、中心セルを**問わない**という前提、±1 の傾斜が**下向きにも**効くこと、探索が 12 セルで打ち止めなこと、同点の行き先、そして**向きを正の定数倍しても答えが変わらないこと**（§5-1 の所有権論をテストにしたもの）。非有限入力に対する 2 つの全域化は**参照実装との乖離**であり、そう明記してある |

| `test/portal-dwell.test.ts` | 16 | **ポータルの発火タイマー**（§3-1 の 6 行目）。参照実装に**移植できる単体テストが 1 本も無い** —— `physics-stage-portal.test.ts` は stage 丸ごとをモックに対して回すもので、そこから入った 2 本はチャンク座標の主張だった（§2-2-1）。なので `physics-stage-portal.ts:35-100` の算術に対して直接書いてある: 4 秒で**ちょうど 1 回**発火すること、**フレームレートを変えても同じフレームで**発火すること（1s x4 / 0.5s x8 / 4s x1）、途中で出ると滞在を**忘れる**こと、冷却中は `inPortal` を**見ない**こと。最後の 1 本は 16 秒ぶん回して `[4, 12]` を固定する —— **到着した先はポータルの中**なので、冷却が無ければ 4 秒ごとに次元を往復し続ける。定数 2 つは `=== 4` ではなく `> 0` で固定する（どちらも**転記であって根拠が無い**ため。`domain/portal-dwell.ts` のヘッダ）。**変異 10 件で赤を確認済み**、うち 1 件は等価変異で、それが `Math.max(0, ...)` の**落ちようのないガード**を見つけて消させた（§4-b F-4 と同じ形） |

`test/support/` はテストではなくテストの資材である（`vitest.config.ts` の `include` は
`test/**/*.{test,spec}.ts` なので収集されない）。`chunk-store-double.ts` が mc-worldgen の
`ChunkStore` のダブル（read / write 回数も数える）、`frame-runner.ts` が `after` を解決して
フレームを回す mc-compose の代役である。後者があるのは、配列順で回すテストが
**順序制約を消しても pass してしまう**からである。

主 API は `@effect/vitest` の `it.effect`。`vitest.config.ts` は `environment: 'node'`。
DOM は使わない — `tsconfig.base.json` が `lib: ["ES2024"]` なので、そもそも型が無い。

`test/public-api.test.ts` が独立しているのは、**他のテストが全部モジュールを直接 import している**からである。
`index.ts` から再エクスポートが 1 本落ちても他のテストは 1 つも落ちず、
それでいて唯一の消費者（`mc-compose`）は壊れる。バレルは名前で固定するしかない。
このテストは「列挙されているものが全部**契約**だ」とは言っていない（[public-api.md](./public-api.md) §5）。

### 2-1. テストの書き方

- **タイトルに「何を守っているか」を書く。** `works correctly` ではなく、
  `REGRESSION: an inactive lava tick RETAINS the lava frontier instead of dropping it` のように、
  落ちたときに何が壊れたかがタイトルだけで分かる名前にする。
- **`REGRESSION:` 接頭辞は「参照実装の production で実際に起きた」ことを意味する。**
  想像した失敗には付けない。区別が付かなくなると、後から「これは本当に起きたのか」を確かめられなくなる。
- **由来を書く。** 参照実装の `path:line`、plan.md の節番号。
  「なぜこの値なのか」が分からないテストは、将来だれかが「たぶん間違いだろう」と直してしまう。
  DN-GP-2 の既知の限界（水だけのフロンティアが予算の半分しか使わない）が
  コメントつきで残っているのはこのためである。

### 2-2. 参照実装のテストはオラクルである。仕様を再発明しない

plan.md §8:

> 参照実装を仕様書として使い、テスト資産を各Stepで**先に**移植する。**ゼロから仕様を再発明しない**

移植可能なオラクルの**ファイル数**（interaction 33 / Mob 61 / 流体 9 / 落下ブロック 2 / 昼夜 2）は
[porting.md](./porting.md) §4 にまとめてある。**実装より先に移植すること。**

> **この行は以前この 5 つを「実測本数」と書いていた。本数ではなくファイル数である。**
> 再実測すると `it` の本数は 1 桁違う —— 流体は 9 ファイル / **94 本**、昼夜は 2 ファイル / **29 本**、
> 落下ブロックは 2 ファイル / **19 本**、interaction は 33 ファイル / **402 本**。
> porting.md §4 の列見出しは最初から「ファイル数」であり、**間違っていたのはこの行だけ**である。
> 数字を引用するときに単位を変えた典型で、porting.md §1 が LOC について立てた規則
> （計数条件を書く／規則をまたいで引き算しない）がテスト本数には及んでいなかった。
> 内訳と再実測手順は porting.md §4-1。

### 2-2-1. 移植の状況（2026-07-27）

**参照実装のテストファイルを 25 本ぶん転記してある**（`test/**` の `packages/…test.ts` 引用を
重複排除して実測）。**23 から 2 増えたのは `interaction-*` から**であり、内訳は下の
「`interaction-*`」の段落と porting.md §4-4。領域別:

| 領域 | 状態 |
| --- | --- |
| Mob | 10 ファイル分 —— 9 本を `test/mob.test.ts` へ（75 本）、`mob-spawner-helpers` を `test/mob-spawn-search.test.ts` へ。porting.md §4 の表に内訳 |
| スポーン探索 | リングが**一周する**こと（`mob-spawner-helpers.test.ts:6-13`）と、出したセルが**3D でも**掃除距離の内側であること（`mob-spawner-rules.test.ts:18-20`）。列走査・カーソル・水中スポーンは**意図的な乖離**（porting.md §4-3-3） |
| 天候 | 参照実装の `weather.test.ts` の **8 本を値を変えずに** + `weather-service.test.ts` の 3 連続遷移 1 本（`test/weather.test.ts`）。同ファイルの残り 4 本は同じ主張の重複、3 本は状態なので拒否 |
| 設置 | `block-service-utils.test.ts:84-98` の境界表 + `block-utils.test.ts:88-121` の**第 2 の表** + `block-support.test.ts` の共有 fallback 行と `SUPPORT_RULES` 行 |
| ブロックのドロップ | fortune 表・葉のボーナス・ボーナス 4 率 + 道具の段の**真の包含鎖**と**段ごとの 4 行** |
| 落下ブロック | 液体を貫く 2 本。残りは走査のテストなので**拒否**（porting.md §4-2） |
| 流体 | 予算配分 6 本。`fluid-contact.test.ts` の 7 本は **§3-3 の所有権未決でブロック中** |
| 昼夜 | **移植すべきものが無い。** 参照実装の 29 本は全件が見た目であり mc-render の担当（porting.md §3-4） |
| 乗り物（レール） | `rail-shape.test.ts` の 10 本のうち **7 本**（`resolveRailShape` 5 + `isAscendingAhead` 2）をトポロジとして実装済み。残る 3 本は `projectMinecartVelocity` のもので、**こちらも実装済み**。フレームへの配線は別問題で、[responsibility.md](./responsibility.md) §5-5 にあるとおり `mc-sim` 側の消費者待ち |
| ブロック別の設置ルール | `block-placement-rules.test.ts` の **4 本を全件**（`localHorizontalNeighbors` / キノコの光量 / サトウキビの隣接水 / サボテンの側面）を `test/placement-rules.test.ts` へ。値は変えていないが**名前ではなくバイトで**問うている。1 本目だけは**主張を反転させて**転記した —— 参照実装は「チャンク内の隣だけを作る」ことを確かめており、こちらは**4 方向すべてを作る**ことを確かめる（下記） |
| ポータルの枠 | `world/domain/nether/portal-frame.test.ts` に当たるものは **mc-worldgen 側**にある。こちらの `test/portal-frame-mirror.test.ts` はミラーを固定するもので、**生成 → 検出の往復を全合法サイズ（2 軸 × 20 幅 × 19 高＝760 通り）**掃く。手書きの枠だけで試した検出器は、テストの作者＝検出器の作者なので必ず一致する |

**`interaction-*`（33 ファイル / 402 本）から引いたのは 3 ファイル・累計 `it` 6 本である。**
内訳は porting.md §4-4 と §4-5。全件 `test/chunk-window.test.ts` にあり、
チャンク座標のヘルパーとチャンクバッファの読みについての主張である。
**「累計」と「この回の新規」を分けて書く**（porting.md §4-2-1 が「追加」という語について
立てた規則）—— 累計 6 本のうち **4 本がこの回の新規**で、残り 2 本は前回からある:

| 参照実装のファイル | 主張 | 累計 | うち新規 |
| --- | --- | ---: | ---: |
| `interaction-flint-steel-portal.test.ts` | 3×3 近傍の構築、**負の座標を含む**チャンクキーの重複排除（前回）、負のアンカーからの入れ子（新規） | 3 | 1 |
| `interaction-stage-underwater.test.ts` | 近傍は **dx-major, dz-minor** の順、floor するのは**商であって座標ではない** | 2 | 2 |
| `interaction-block-access.test.ts` | **F9 —— 切り詰めたバッファを unreadable とする**（porting.md §4-4-1） | 1 | 1 |

3×3 は**検出器自身の上限から導いた半径**（`PORTAL_WINDOW_RADIUS`）に置き換わっているが、
守っている性質 —— `-1 % 16` が `-1` になる言語で西隣のチャンクを取り違えないこと ——
はそのまま守られている。

**残りが `mc-sim` の公開 API 待ちだという説明は正確ではない。**
porting.md §4-5 が 33 ファイルを 1 行ずつ、**欠けている型かサービスのメソッド名で**断ってある
（「mc-sim」とだけ書いた行は 1 つも無い）。実際に多いのは kernel の語の欠落
（`bread` / `shears` / `hoe` / `bucket` / 防具語）と、`EntityState` に無い場のほうである。
§5-3 の表のうち**弓とエンダーパールの行は期限切れだった** —— 語は今も無いまま閉じた
（porting.md §4-5-1）。
`test/place-block.test.ts` と `test/block-loot.test.ts` は以前から `packages/world` 側の
テストから**一部の主張**を取っている。**条件 3 が「部分」である主因は依然ここである**（§3）。

**参照実装と食い違いを 1 つ増やした**（向きはこちら側が正しい、と主張する側）。
`localHorizontalNeighbors` はチャンク外の隣を**リストから落とす**。これはルールではなく、
その関数の呼び手が `Chunk` を 1 枚しか持っていないことの副作用だが、**答えを変える**:
チャンク境界のサボテンは 3 面しか検査されず、境界のサトウキビは 1 セル隣の水が見えない。
どちらも**位置によって効いたり効かなかったりする設置ルール**である。
こちらはセルを `ChunkStore` 越しに読むのでその制限が無く、
`domain/block-position-key.ts` の `horizontalNeighbours` は常に 4 つ返す。
読めなかった隣は**air とは見なさない**ので、拒否の向きに倒れる。

各回に何を移植し何を断ったかは [porting.md](./porting.md) §4-2 / §4-3 に主張単位で表がある。
**移植したものは全件、production を壊して赤を確認してある。**
参照実装と食い違ったものは 2 件あり、向きが逆である —— F8（§3-6、こちらが追随すべき）と
「光が読めないセル」（porting.md §4-3-3、こちらが意図して逆に倒している）。

### 2-3. 他リポジトリの席から roster を読む

`scripts/check-dependency-whitelist.ts` の各コピーは**全 16 リポジトリの roster** を抱えている。
しかし import 検査が実際に参照するのは `thisPackage` の行だけなので、
**他人の行の間違いはこの席からは一生見えない。**

`PolicyView` を差し替えて「このゲートが `mx-ui` に置かれていたら何と言うか」を問うのが
`describe('the roster, read from the seat of another repository')` の 3 本である。

| it | 何を確かめるか |
| --- | --- |
| `REGRESSION: seated in mx-ui, importing mx-gameplay is rejected — the zero-edge rule is symmetric` | ゼロエッジ規則が**対称**であること。こちらから兄弟を見ないだけでなく、兄弟からこちらも見えない |
| `mc-compose IS allowed to import mx-gameplay — it is the one repository that may` | 唯一の合法な消費者 |
| `REGRESSION: mc-compose may not reach past its four children to mc-sim` | compose は 4 つの子より先に手を伸ばせない。「composeの追加コードはLayer合成とstage順序表だけ」（plan.md §3.15）を強制可能に保つ |

3 本目は `mx-gameplay` の CI で `mc-compose` の規則を検査していることになる。妙に見えるが、
roster を各リポジトリが持ち回っている以上、**行の正しさはどの席からでも検査できるほうがよい**。
本来は `mc-dev-meta` が組織全体のグラフを publish して各リポジトリが消費する形にすべきで、
現在の手写しはその暫定である（スクリプト冒頭の Known limits に記載）。

## 3. 完成条件

| # | 条件 | 状態 |
| --- | --- | --- |
| 1 | `pnpm verify` が green | ✅ |
| 2 | plan.md §3.11 の 7 つの責務が実装済み | ⚠️ **部分**（**3 が実装済み、4 が部分、未着手は 0**。内訳は §3-1、そこの末尾に 4 つの「部分」がそれぞれ何を待っているかも並べてある。**この行と §3-1 は突き合わせて書いた** —— 過去にこの 2 つは 6 回食い違っている。**今回の更新でも 2 つを同時に書いた**: 責務 1 の「アイテム使用」は弓とエンダーパールが入って**ルールと配線が閉じ**、残るのは kernel の 8 語と能力 1 つになったが、**部分のまま**であり内訳の数 3 / 4 / 0 は変わらない） |
| 3 | 参照実装のテストオラクルが移植済み | ⚠️ **部分**（参照実装のテストファイル **25 本ぶん**を転記 —— **この数はこの行と §2-2-1 で食い違っていた**（20 と 21）ので実測して両方を合わせ、以後は同時に書いている。**Mob・スポーン探索・天候・設置（ブロック別 4 本を含む）・ドロップ・落下ブロック・流体の予算配分は閉じており**、拒否は全件が理由つき。**`interaction-*` の 33 ファイル / 402 本からは 3 ファイル・累計 `it` 6 本、うちこの回の新規は 4 本**（§2-2-1 の表、porting.md §4-4）。**残りを「`mc-sim` の公開 API 待ち」と書いていたのは不正確で**、porting.md §4-5 が 33 ファイルを 1 行ずつ**欠けている型かメソッド名で**断ってある —— 実際に多いのは kernel の語（`bread` / `shears` / `hoe` / `bucket` / 防具語）と `EntityState` に無い場である。§5-3 の弓とエンダーパールの行は**期限切れだった**（porting.md §4-5-1）。F9 は参照実装との一致へ修正済み（porting.md §4-4-1）。ほかに所有権待ちが 1 つ（`fluid-contact.test.ts` の 7 本、§3-3）。**❌ ではなく部分と書く** —— 内訳は §2-2-1） |
| 4 | **プレビュー「採掘場」が操作可能** | ✅（`pnpm preview`。plan.md §3.11 が名指しする **3 つとも** —— `b` で掘り、`p` でルールを通して置き、`t` で道具の段を替えると HUD のインベントリが変わる。**その「HUD のインベントリ」は、もはやプレビューが自分で数えた集計ではない** —— `apps/preview-mining-site/inventory.ts` が mc-sim の `InventoryService` を演じ、画面の数字は `snapshot` の射影である。§3-3） |
| 5 | **プレビュー「Mob アリーナ」が操作可能** | ✅（`--screen arena`。**plan.md §3.11 の 4 挙動のうち 3 つ。** スポーン → 導火線 → 爆風 → 死因 → ドロップ、エンダーマンのテレポート判断と変位、シュルカーの殻、そして掃除が本物。4 つ目のドラゴンは**理由つきの拒否**として画面に載る。§3-3） |
| 6 | **プレビュー「時間スライダー」が操作可能** | ✅（`--screen time`。昼夜と**天候**の両方。時刻を**進める**のは mc-sim であり、そちらは未 publish。天候は所有者が 1 人もいないので画面が持つ —— `domain/weather.ts` の冒頭） |
| 7 | 99% カバレッジゲートが有効 | ✅（`vitest.config.ts` の `thresholds` + CI の `Coverage (99% gate)` ステップ。実測 99.75 / **99.37** / 100 / 99.75、§4。**この行と §4 の実測値は 99.71 と 99.74 で食い違っていた**ので両方を合わせた） |
| 8 | `mc-kernel` を import し `domain/frame-contract.ts` / `domain/position-key.ts` を削除 | ❌（kernel の publish 待ち） |

### 3-1. 条件 2 の内訳（この行は「1 つも未着手」と書かれたまま古くなっていた）

> **節番号を振り直した。** この節と「プレビューが見つけたもの」の両方が `3-2` を名乗っていて、
> 「§3-2 を見よ」がどちらを指すのか本文からは決まらなかった。同じ番号が 2 つあるのは
> この文書自身が主要な失敗様式として挙げているもの（状態表が実際と食い違う）の一種なので、
> 出現順に 3-1 / 3-2 / 3-3 / 3-4 へ振り直し、参照側も直してある。

**この表は実ファイルを数えて作った。** 旧記述「1 つも未着手」は**同じ表の 4〜6 行目と矛盾していた** ——
そこにはプレビュー 3 本が ✅ で載っており、Mob アリーナは「本物。plan.md §3.11 の 4 挙動のうち 3 つ」と
書いてある。**状態表が実装より古くなると、「あと何が残っているか」が誰にも分からなくなる。**

| # | plan.md §3.11 の責務 | 状態 | 実体 / 欠けているもの |
| --- | --- | --- | --- |
| 1 | 採掘 / 設置 / アイテム使用 | **部分**（設置は閉じた。アイテム使用は**ルールが全部書けて配線も済み**、残るは kernel の 8 語と、矢を止めるブロックの能力 1 つ） | 3 つの動詞すべてが `gameplay:interactions` から回っている。**採掘**は `break-block.ts`、**設置**は `place-block.ts` と**ブロック別ルール 4 本**（`place-mushroom-light.ts` / `place-sugar-cane-water.ts` / `place-cactus-sides.ts` / `place-door-upper.ts` —— DN-GP-9 のとおり 1 ルール 1 ファイルで、`place-block.ts` が名前で呼ぶ）、**アイテム使用**は `use-flint-and-steel.ts` → `ignite-portal.ts` / `ignite-fire.ts` で、`pendingItemUses` / `usedItems` の inbox・outbox が付いている。**この行の「先送りであって拒否ではない」は履行された。**<br><br>**採掘の行き先が Ref ではなくなった。** `stages/registration.ts` は掘れたスタックを `state.minedItems` に積むだけで、その送信箱を抜く者は誰も書かれていなかった。`domain/inventory-port.ts` が mc-sim の `InventoryService` を丸ごと写し、stage が `add` を呼ぶ。**残った Ref は `leftoverItems` 1 本で、中身は `add` が「入らなかった」と答えた数だけである** —— 捨てると、プレイヤーが掘ったのに持っていないアイテムになる。それを地面のドロップ item にするには `MobBehaviour` の腕・`repairMobBehaviour` の腕・拾得ルールが要るので、そこで止めて**保持**してある。**設置の側（`consumedItems`）はまだ送信箱である**: `remove` は「実際に取れた数」を返すのに `placeBlock` は既にセルを書き終えているので、stage から呼ぶと 0 が返ったときプレイヤーが持っていないブロックを世界に置いたことになる。正しくやるには設置ルールが**書く前に**インベントリを読む必要があり、それは配線ではなくルールの変更である。<br><br>**弓とエンダーパールが入った。** `domain/interactions/draw-bow.ts`（引き・チャージ・二次のダメージ）、`bow-shot.ts`（クロスヘア内の最近傍への hitscan と、注入された述語で受ける遮蔽判定）、`knockback.ts`（ノックバックの**向き**。§7-3 が所有権を割っている）、`throw-ender-pearl.ts`（変位・自傷 5・エンダーマイト 5%）で、**4 本とも `gameplay:interactions` から回っている** —— `pendingBowShots` / `bowKnockbacks` と `pendingPearlThrows` / `enderPearlOutcomes` が 4 つ目と 5 つ目の inbox・outbox である。エンダーマイトは `roster.spawn` で**本当に湧く**（`ENDERMITE_KIND`、`HOSTILE_KINDS` には**入れない** —— 理由と代償はその定数のヘッダ）。<br><br>**この行の「発射体だから」は測って誤りだった。** 旧記述は「弓とエンダーパールは**それに加えて**発射体なので mc-sim の名簿と mc-physics の速度も要る」で、**どちらも発射体ではない**: 弓は `interaction-bow-handler.ts:200` が自分で「Hitscan」と書いており、近接と同じ `findAttackableEntity` を reach だけ替えて呼ぶ。エンダーパールは `ender-pearl.ts:8` でホストが済ませた `TargetRayHit` を取り、同じフレームで移動する。**実体は 1 つも作られず、速度はどこにも書かれない。** もっともらしい**カテゴリ**（「発射体」）から書かれた拒否で、カテゴリは確かめられない —— [responsibility.md](./responsibility.md) §7-1 が経緯と、**これが 4 度目である**ことを書いている。<br><br>**残りは kernel への名簿要求であって、こちらの穴ではない。** バケツ・ハサミ・弓・エンダーパール・鍬は `ITEM_TYPES`（97 語）に**綴りが存在しない** —— `bucket` / `water_bucket` / `lava_bucket` / `shears` / `bow` / `arrow` / `ender_pearl` / `hoe` の 8 語で、書けばこのリポジトリが kernel の語彙を発明することになる（mc-sim の 7 語要求が先例）。**8 語すべてが「語だけで閉じる」になった**（responsibility.md §7）。3 語が無いことで実際に失われているのは狙いでも命中判定でもなく**インベントリの出納**で、矢の消費・弓の耐久・パールの消費がそれである —— つまり**今日の弓は矢を消費せず無限に撃てる**。`test/bow.test.ts` の「THE BOW FIRES FOR FREE」が名指しでそれを固定してあり、3 語が来た日に落ちる。<br><br>**語とは無関係な穴が 1 つ残った**: 矢を止めるブロックの表（kernel の能力で、ミラーしている 4 つの述語のどれでもない）が無いので、`shotBlockedByTerrain` は**書いてありテストもあるが stage からは呼ばれておらず**、弓は壁を撃ち抜く。`isReplaceable` での代用は所有者の宣言していない等価の発明なので採らない。responsibility.md §7-2 が唯一の記述である。<br><br>kernel 0.2.5 で support-sensitive plant 10 語が `ITEM_TYPES` と `PlaceableItemType` に入り、ブロック別ルール 4 本はすべて実配置経路から到達可能になった。`test/placement-rules.test.ts` は実リテラルでキノコの明るさ・サトウキビの水隣接・サボテンの側面空間を検証し、`test/place-block.test.ts` は 10 種すべての support 条件を `placeBlock` 経由で検証する |
| 2 | Mob AI | **部分** | `domain/mob/` 7 本 + `domain/entities/mob-frame.ts` で**フレームに配線済み**。4 挙動のうち 3 つ。ドラゴンは §3-3 のとおり**理由つきの拒否** |
| 3 | ドロップ / ルートテーブル | **実装済み** | `domain/mob/mob-drop.ts`（クリーパー / ガスト / ブレイズ、`lootingLevel` 込み）と `domain/interactions/block-loot.ts`。後者は kernel の `drops` / `harvestTool` 列（`domain/block-vocabulary.ts` にミラー）を通る決定論的な半分と、audit §6-9 がこちらに置いた乱数の半分（fortune、葉のボーナス）である。**掘って出るのは「そこにあったブロック」ではなくなった** —— 石はまるい石になり、素手では何も出ない。**そして出たものは mc-sim の `InventoryService` に入る**（§3-1 の 1 行目） |
| 4 | 流体伝播 | **実装済み** | `domain/fluid-frontier.ts`。plan.md §3.11 が名指しするフロンティア上限つき |
| 5 | 乗り物（ボート / トロッコ / レール） | **部分** | **レールのトポロジは実装済み**: `domain/vehicle/rail-shape.ts`（`resolveRailShape` / `RailShape` / `IsRailAt`）と `domain/vehicle/rail-ascent.ts`（`isAscendingAhead`）。どちらも import が 1 本も無い純関数で、ブロックの読みは**注入された述語**で受ける。**フレームには配線されていない** —— カートの速度も名簿も `mc-sim` に無いためで、欠けているものは [responsibility.md](./responsibility.md) §5-5 に名指しで並べてある。記号ごとの所有権（`projectMinecartVelocity` と `RAIL_CLIMB_SPEED` を含む）は同 §5 が**唯一の記述**である。旧記述「未着手」の根拠は §3-2 のとおり間違っていた |
| 6 | ポータル / 次元移動 | **ほぼ完**（点火・**発火タイマー**・**適用**が入った。残るのは既存ポータルの**再利用**だけで、それは `knownPortals` の所有者が居ないことによる） | 参照実装がこの責務を**3 ファイルに割っている**とおりに割れた。**枠の検出**は mc-worldgen の `domain/portal-frame.ts`（`detectNetherPortal`）で、こちらは `domain/portal-frame-port.ts` として**ミラー**する —— `domain/chunk-store-port.ts` が `ChunkStore` をミラーするのと同じやり方で、import ではない。**点火**は `domain/interactions/ignite-portal.ts` で、これがこの行の残りだった分である。<br><br>`detectNetherPortal` は**同期**の `BlockAt` を取り、1 回で約 500 セルを探る。こちらのブロック読みは全部 `Effect` なので、その 2 つは合わない —— `domain/chunk-window.ts` がその橋で、その冒頭に**3 つの案と、選ばなかった 2 つを落とした理由**（セル単位＝右クリック 1 回あたり 3,872 回のストア呼び出し／要求駆動の不動点＝他人の制御フローに依存した限界）が書いてある。選んだのは参照実装と同じ形、チャンクを peek してバッファを引く方式である。**`ChunkNotLoaded` は近道の中でも air にならない**: 常駐していないチャンクのセルは `UNREADABLE_BLOCK`（`-1`、どの registry 行でもない）を返して**数えられ**、`ignite-portal.ts` はそれを `NoFrame` ではなく `ChunkNotLoaded` として報告する。<br><br>**3 本目も 3 つに割れた。** 参照実装の `physics-stage-portal.ts` はプレイヤーの位置を読み、十分に立ったと判断し、別次元へ置く —— この「**十分に立った**」が `domain/portal-dwell.ts`（`stepPortalDwell`）で、**4 秒の滞在と 4 秒の再突入冷却**は名簿ではなく**時間**である。`domain/mob/creeper-fuse.ts` と同じ形（タグつき状態機械、`DeltaTimeSecs`、overshoot が効く `>=`）で、座標を 1 つも持たない。「**どこへ**置くか」は mc-worldgen の `domain/nether-link.ts` / `domain/nether-travel.ts` に入った。<br><br>**「置く」も入った。3 つに割れた見立ては正しく、3 つとも解けた** —— [responsibility.md](./responsibility.md) §6-2 が実測の唯一の記述である。(a) **次元という名詞の所有者**は **mc-worldgen** に決まった（kernel ではない —— kernel に `Dimension` 型は今も無く、候補ではあっても現職ではなかった）。名指ししていた `PlayerServiceApi.dimension` / `setDimension` は**その名前のまま存在する**。 (b) **「どこへ」はバレルに出た** —— 語を所有すると決めた以上伏せる理由が失効し、`index.ts` は `./domain/nether-travel` を出している。`domain/nether-travel-port.ts` は publish 済 module のミラーである。 (c) **`api-lock.md` は動いた**（`pnpm api:update` 済。`gameplayStages` は第 5 引数、`makeGameplayStages` は 4 つ目の要求サービスを得た）—— 見積り通りであり、待つ代償のほうが大きくなった時点で払った。**残るのは `knownPortals` の所有者だけで、それは barrel の問題ではなく所有の問題である** |
| 7 | 昼夜・天候 | **実装済み** | `domain/day-night.ts`（`isNight` / `dayPhase` / `hostileSpawnsAllowed`）と `domain/weather.ts`（遷移グラフ・継続時間・`isPrecipitating` / `isThunderstorm` / `weatherLightScale`）。`gameplay:time-weather` は **`Effect.void` ではなくなった**。時刻を**進める**のは依然 mc-sim の `TimeService` である |

**3・4・7 が実装済み、1・2・5・6 が部分、未着手は 0 である。**
**7 つの責務すべてに実体がある。** 6 は点火ルールとミラーが入って **未着手 → 部分** に変わり
（§3-2）、5 はそれ以前にレールのトポロジ 2 本で同じ移動をしている。

**「部分」の 4 つが何を待っているかは 4 つとも別である。** 1 は kernel の `ITEM_TYPES` に
8 語（要求であって穴ではない）と、**矢を止めるブロックの能力 1 つ**（responsibility.md §7-2）、
2 は絶対ワールド Y と速度（ドラゴン、理由つきの拒否）、
5 は `mc-sim` のカート速度と名簿、6 は**次元という名詞そのもの**（`mc-sim` の名簿ではない ——
その半分は §3-2 のとおり誤りで、ミラーが書かれて消えた）。
**このうち 1 だけがこのリポジトリの外に語と表を足せば閉じる。** 残り 3 つは実体が要る。

**1 が待っているものは、以前より 1 つ減って 1 つ増えた。** 減ったのは
「弓とエンダーパールは発射体なので mc-sim の名簿と mc-physics の速度も要る」で、
これは**測って誤りだった**（§3-1 の 1 行目、responsibility.md §7-1）。
増えたのは能力 1 つで、それは弓を**書いてはじめて分かった**もの ——
拒否が消えると、その後ろにあった本物の欠落が見えるようになる。

### 3-2. 旧「未着手の 2 つ」—— 根拠は**測って間違いだった**、そして 5 も 6 も着手した

この節は以前こう書いていた:

> 乗り物とポータルはどちらも「位置を持つ実体を動かす」ものであり、
> 速度を出す側は mc-physics、実体の名簿は mc-sim である —— エンダードラゴンを
> `domain/mob/` から拒否したのと同じ理由がこの 2 つにもそのまま当たる可能性が高い。

**参照実装を読んで確かめた結果、5 については誤りで、6 については結論だけが正しい。**

そして最初に見るべきだったのは参照実装ではなく plan.md §7 のほうだった。
[responsibility.md](./responsibility.md) §2 が既に書き出している 5 行のうち、この 2 つはこうなっている:

| 機能領域 | 割り当て先 | mx-gameplay の取り分 |
| --- | --- | --- |
| 乗り物（ボート/トロッコ/パワードレール）のルール | **gameplay** | 全部 |
| 次元（ネザー/エンド、次元別地形・Mob 名簿・次元永続化） | worldgen + sim + gameplay + save | **次元移動のルール**（ポータル成立条件・遷移の発火） |

**乗り物のルールは「全部」ここである** —— 単独割り当ての 2 行のうちの 1 行で、
「所有権を決めるべき行」ではもともと無かった。ポータルのほうは 4 リポジトリの分担行で、
こちらは確かに「決めるべき行」である。旧記述は**この表を読まずに 2 行を同じ箱に入れていた。**

**5（乗り物）。** 「位置を持つ実体を動かす」で説明が付くのは**半分だけ**である。
乗っている状態は `packages/game/application/game-state-service.ts:76` の `Ref<boolean>` ——
状態なので mc-sim のもの —— である。残りの半分はそうではない:

- `resolveRailShape`（`packages/game/domain/rail-shape.ts:18-34`）は
  **1 セルの周囲 4 方向のブロック読みだけ**の全域関数である。速度も名簿も出てこない。
  これは `domain/interactions/place-block.ts` の支え判定や
  `domain/entities/mob-spawn-search.ts` のリングと**同じ形**である。
- 語彙も揃っている: kernel の `BLOCK_REGISTRY` は `rail`(31) と `powered_rail`(32) を既に持つ。

**その半分は書いた。** `domain/vehicle/rail-shape.ts` と `domain/vehicle/rail-ascent.ts` で、
§3-1 の 5 行目は**部分**になった。

**記号ごとの行き先は [responsibility.md](./responsibility.md) §5 が唯一の記述であり、ここでは繰り返さない。**
そこで直っている点だけ挙げると: 本節の旧記述は残りを「速度を出す側は mc-physics」で片付けていたが、
`mc-physics/docs/responsibility.md` §3 のスコープ表には
「乗り物（ボート / トロッコ）の**物理** → mx-gameplay」という行が既にあり、
かつ本リポジトリは mc-physics を直接 import できない（[responsibility.md](./responsibility.md) §3）。
**mc-physics は 5 記号のうち 1 つも取らない**（§5-2）。置き場も
`domain/interactions/` ではなく `domain/vehicle/` になった（§5-6）。
実際にある線は所有権ではなく**到達可能性**で、`mc-sim` に何が要るかは §5-5 にある。

**6（ポータル）。** ここも**測ったら間違いだった** —— 5 と同じ向きに、1 段遅れて。

この節は「着手すべきでないという結論が正しく、理由が違う」と書いていた。
理由の部分は正しかった: 参照実装はポータル関連を 1 つ残らず **world パッケージ**に置いており、
mc-physics の速度でも mc-sim の名簿でもなく **mc-worldgen の構造と座標**である。
**結論のほうが 3 分の 1 だけ間違っていた。** 参照実装はこの責務を 3 ファイルに割っており、
そのうち**アイテム使用の 1 本はこのリポジトリのもの**である:

| 参照実装のファイル | 何をするか | 行き先 | 状態 |
| --- | --- | --- | --- |
| `packages/world/domain/nether/portal-frame.ts` | 枠の**形** | mc-worldgen | ✅ landed（`detectNetherPortal`） |
| `packages/app/.../interaction-flint-steel-portal.ts` | **点火** | **mx-gameplay** | ✅ `domain/interactions/ignite-portal.ts` |
| `packages/app/.../physics-stage-portal.ts` の**発火判定** | 4 秒立ったか。再突入の冷却 | **mx-gameplay** | ✅ `domain/portal-dwell.ts`（`stepPortalDwell`） |
| `packages/app/.../physics-stage-portal.ts` の**移動先** | 8:1 スケーリング、既存ポータルの再利用、無ければ設計 | **mc-worldgen** | ✅ `domain/nether-link.ts` / `domain/nether-travel.ts`。ただし**バレルには出ていない** —— mc-worldgen の `index.ts` は `./domain/portal-frame` を出してこの 2 本を出さないので、**こちらからは呼べない**（`Dimension` を意図的に非公開にしているため） |
| `packages/app/.../physics-stage-portal.ts` の**適用** | プレイヤーをそこへ置き、次元を切り替える | **置くほうは mx-gameplay** | ✅ **閉じた。** `domain/portal-travel.ts` の `applyPortalTravel` が `moveTo` と `setDimension` を対で呼び、`stages/registration.ts` の `stepPortalTravel` が `gameplay:interactions` から**毎フレーム呼ぶ**。`test/portal-travel.test.ts` は 8 本で、うち REACHABILITY 節は**本物の stage を回して**次元が変わることを見る —— 配線を消すと correctness 側 7 本は緑のまま REACHABILITY だけが赤くなる（実測）。次元の語は **mc-worldgen** が所有すると決まり barrel に出た（kernel ではない。kernel に `Dimension` 型は今も無い）。**残る制限は `knownPortals` の所有者が居ないことだけ**で、空リストを渡すため既存ポータルを再利用しない —— RESTRICTION 節がそれを固定している |

**「未着手」で 3 本まとめて止めていたのが誤りだった。** 1 本目は隣のリポジトリが書き、
2 本目はここが書けたのに「実体を動かすから」で 3 本まとめて棚上げされていた ——
`ignite-portal.ts` は実体を 1 つも知らない。ブロックを読み、ブロックを書く。

**3 本目は、その 3 本目がさらに 3 つに割れた。** 上の表が 3 行から 5 行になっているのがそれで、
**旧記述の「mc-sim の名簿と次元サービス待ち」は、名簿の側が誤りだった。**

- **滞在時間と冷却は時間であって名簿ではない。** `PORTAL_ACTIVATION_SECS` /
  `PORTAL_REENTRY_COOLDOWN_SECS`（参照実装 `physics-stage-portal.ts:10-11`、
  **どちらも転記であって根拠は無い** —— `domain/portal-dwell.ts` のヘッダがそう書いている）と、
  その上の状態機械。`domain/mob/creeper-fuse.ts` はまったく同じ形で、
  同じ `DeltaTimeSecs` を取り、mc-sim を要ると思われたことは一度も無い。
- **移動先の解決も名簿ではない。** 8:1 のスケーリングも最近傍探索も座標だけの全域関数で、
  mc-worldgen の `docs/responsibility.md` §6 が**先に**そう裁定していた。
- **プレイヤーを動かすことすら名簿ではない。** 参照実装は名簿を触らず
  `gameState.respawn(pos)` を呼ぶ（`physics-stage-portal.ts:63`）。mc-sim の対応物は
  **存在して publish 済み**である —— `PlayerServiceApi.moveTo(feetPosition)`
  （`mc-sim/application/player-service.ts:25`、barrel は `index.ts:40`）。
  こちらに無いのは**そのサービスのミラー**であって、mc-sim に無いメソッドではない。
  **そのミラーは書かれた** —— `domain/player-port.ts` が `PlayerServiceApi` の
  6 メンバ全部を写し（`cameraPose` の `ClockPort` 要求も落とさずに）、
  `test/player-mirror.test.ts` が両方向の代入と鍵の literal を固定し、
  mc-dev-meta の `MIRROR_SPECS` に 13 行目として登録してある。
  **これを止めていた理由は名簿ではなく `ClockPort` だった。** `stages/registration.ts` が
  2 箇所で「`PlayerService` は `ClockPort` を restate せずに丸ごと写せない」と断っており、
  その根拠は `domain/frame-contract.ts` の「kernel と同じ鍵の `Context.Tag` を
  もう 1 つ作ることになる」だった。**その前提が誤りで、反証は組織の中に既にあった** ——
  mc-compose の `domain/kernel-vocabulary.ts` が同じ Port を丸ごと写していて、
  「Effect は Tag を**文字列の鍵**で解決するので、`'@nerima-games/mc-kernel/ClockPort'`
  から作ったミラーは**実行時には kernel のサービスそのもの**である」と書いている。
  `ChunkStore` と `InventoryService` が既に依っている性質と同じもので、
  mx-* が断っていた本当の理由は安全性ではなく**必要が無かったこと**だった
  （mc-compose:「自分では construct しない `Context.Tag` を restate しても何も買えない」）。
  `cameraPose` がその「買えるもの」で、`domain/frame-contract.ts` の clock 節が経緯を持つ。

**本当に無かったのは次元のほうで、いま 1 語ある。**
この段落は「1 語も存在しない」と書いていた。実測は当時も今も同じで、
`grep -rn "Dimension" mc-kernel/domain/*.ts` は無関係なコメント 1 件だけである ——
**kernel は候補ではあっても現職ではなかった**。所有者は **mc-worldgen** に決まった:
参照実装が `packages/world`（= mc-worldgen）に宣言しており、
その union を読むルールを既に所有しているのも mc-worldgen だからである。
「全員が依存しているから」は所有の理由にならない。

`PlayerServiceApi` は `dimension` / `setDimension` を得て、mc-sim が**状態**を持つ。
参照実装が 1 回の通過で 3 回呼んでいるもののうち、**プレイヤーの分はこれで揃った** ——
`chunkManagerService.setActiveDimension` と `entityManager.setActiveDimension` の 2 つは
まだ無い。`EntityManagerApi<S>` は 10 メンバで、そのどれも
「この実体はどの世界に居るのか」を言わない。**Mob が次元を持つのは別の行であり、
プレイヤーが持つことの帰結として自動的には来ない。**

**「着手する前に所有権を決めるべき 1 行」だったのは正しく、そのとおりになった** ——
決めるのに要ったのは実装ではなく、どのリポジトリのものかを論じることだった。

**この節は同じ誤りを 3 回記録していることになる**（5 と 6 と、6 の中でもう一度）。
**そして 6 の残り半分は、カテゴリの誤りではなく本物の欠落だった** ——
所有者の居ない名詞であり、それを決めるまでは誰にも書けなかった。
7 件中 6 件はカテゴリで、1 件は本物である。どれも
「位置を持つ実体を動かす」という 1 文で**複数のファイル**をまとめて棚上げしたもので、
どれもファイル単位で見たら半分以上が純関数だった。
ブロックを読んでブロックを書くルールは、隣に実体が居ても実体のルールではない。
**そして 3 度目は、拒否の理由に挙げた当のサービスに、要るメソッドが既にあった。**
カテゴリで断ると、断った相手を見に行かない。

### 3-3. プレビュー 3 本

plan.md §3.11 が指定する 3 本。`apps/preview-*/` に置く（plan.md §4.1: 「プレビューは契約に含めない」）。

**実装は 1 アプリ 3 画面である**（`apps/preview-mining-site/`、`g` で巡回）。
`pnpm preview` が入口で、`--screen site|time|arena` でも直接開ける。

| プレビュー | 画面 | 実体 | 主に検証されるルール |
| --- | --- | --- | --- |
| **採掘場** | `site` | **本物**。`gameplayStages` を本物の `ChunkStoreApi` に対して回す | `break-block`、`place-block`、`block-loot`、落下ブロック（DN-GP-1）、`ChunkNotLoaded`（DN-GP-11）。**plan.md §3.11 が名指しする「掘る / 置く / ドロップ確認」の 3 つとも本物である。** `b` は破壊要求を受信箱に積み、`p` は**設置要求を積む**（先にルールへ問い、拒否ならその `_tag` を HUD に出して積まない —— stage は拒否を捨てるので、拒否を見られるのはここだけである）。`t` / `u` / `f` で道具の段・シルクタッチ・fortune を変えると、**次のフレームから出るアイテムが変わる**。`--tool none` と `--tool wooden` の 2 枚は、1 行だけ違う貼り付け可能なフレームである。ストアを直接書く鍵は `e` だけになり、**disturb を呼ばない**ことが設置との対比になっている。**`i` で 3 つ目の動詞が入った** —— `domain/interactions/use-flint-and-steel.ts` を通るアイテム使用で、鍵は 1 つで**ルールは 2 つ**である: 黒曜石の枠（`O`、パレット 7）の内側で押すと `%`（ネザーポータル）になり、それ以外では `*`（火）になる。**どちらが走ったかは画面が言わず、世界が言う** —— 落とし込みそのものが見せたいものだからである。ここに dry run が無いのは `p` との不整合ではなく、検出と充填が 1 つのルールだからで、2 度問えば 2 度点火してしまう（`site.ts` の `requestItemUse`）。パレットは 10 になり `0` が 10 番目である。`nether_portal` と `fire` は**選べるが置けない** —— `p` が kernel の答え（アイテム形が無い）を出す。それはキノコ・サトウキビ・サボテンをホットバーから締め出しているのと同じ名簿の事実である。**HUD の `inventory` は mc-sim の答えになった** —— `apps/preview-mining-site/inventory.ts` が `InventoryService` を演じ（`./roster.ts` が名簿について**拒否した**のと対になる判断で、理由はそこに書いた基準そのもの: 採掘がこのサービスを**呼ぶ**ようになったので、拒否する double は最初の一振りで死ぬ）、frame tape の item 欄は `add` の引数リストである。`--stats` の `a mined block reaches mc-sim's inventory` が**満杯のインベントリ**を組んで 1 つ掘り、`!item` として refused を出す |
| **Mob アリーナ** | `arena` | **本物。plan.md §3.11 の 4 挙動のうち 3 つ** | `domain/mob/` の 7 本 —— `hostile-spawn`（夜・光度・`validSpawnSurface`・距離帯）、`creeper-fuse`（着火 / 退避で消える / 1 回だけ爆発）、`explosion`（減衰と死因）、`mob-drop`（クリーパー / ガスト / ブレイズ。自爆なら何も出ない）、`enderman-teleport`（3 つの引き金と 8..32 ブロックの変位）、`shulker-shell`（開くのに 20 フレーム、閉じるのに 1）、`hostile-despawn`（3D で 128 ブロック）と、それらが到達する `domain/death-cause.ts`（DN-GP-3）。**状態はプレビューが持つ** —— mc-sim の役をこの画面が務めており、`ArenaCreeper` 4 欄 + `ArenaShulker` 6 欄 + `ArenaEnderman` 4 欄のどれ 1 つも位置でも id でも乱数生成器でもない。欠けているものは**行き先つきで**列挙し続ける（4 つ目の挙動＝ドラゴンは、**理由つきの拒否**として一覧の先頭に載る） |
| **時間スライダー** | `time` | **ルールドライバとしては本物**。昼夜と天候の両方 | `domain/day-night.ts` の `isNight` / `dayPhase` / `hostileSpawnsAllowed`（DN-GP-7）と、`domain/weather.ts` の遷移グラフ・継続時間・`isPrecipitating` / `isThunderstorm` / `weatherLightScale`。**時刻そのものを動かすのは依然 mc-sim の `TimeService`** である。**天候は動かす** —— `gameplay:time-weather` はもう `Effect.void` ではなく、`.` が 60 秒進め、`w` が次の遷移まで早送りする（§5 の fast-forward）。画面が値を持っているのは書く先が無いからではなく、**天候には所有者が 1 人もいない**からである（`domain/weather.ts` の冒頭）。遷移表は転記ではなくルールに**問うて**描いてあるので、表と実装が食い違えない |

**`mc-playground-kit` は使っていない。** 本節は以前「いずれも kit を devDependency として使う」と
書いていたが、kit は publish されておらず（plan.md §6 Step 3 はボトムアップ）、
**実行できないプレビューは完成条件ではなく「完成条件を持つ計画」である**。
加えて、これら 3 本が可視化しろと言われているものは全部「座標に付いた数」か「瞬間に付いた数」——
どのセルがキューに入っているか、1 フレームが何回ストアを読んだか、カスケードが何 tick 掛かったか、
0.31 は何フェーズか——であり、カメラはそのどれにも寄与せず、
**柱全体とキュー全体を一度に見る**能力を奪う。mc-worldgen の地形プレビューが最初にこの論を立て、
mx-redstone の回路盤が磨いた。`tsconfig.base.json` が `lib` から "DOM" を落としているという
機械的保証も、ターミナルレンダラなら壊さずに済む。

将来 1 人称プレビュー（mc-sim の障害物コースのような）が要るなら、そのときは kit が正しい置き場である。
そのときも実行時依存に混ざったら `pnpm check:deps` が落とす（plan.md §2.3-2）。

**なぜプレビューが完成条件なのか。** テストは「決めた通りに動くか」を見るが、
「決めたことが遊びとして正しいか」は見ない。溶岩湖の縁が直線になっていること（DN-GP-2）は
どの assertion にも引っかからず、プレビューを数分動かせば一目で分かる。
参照実装のあのバグが数分後に現れるものだったのは偶然ではなく、**型と単体テストが見ない層で起きるバグ**が
このリポジトリの主要な失敗様式だからである。

### 3-4. プレビューが見つけたもの

`pnpm preview --stats` は 20 個のチェックを**実行時に測定**する。期待値は 1 つも記録していないので、
**直すと finding は「固定される」のではなく静かに消える**。だから確認できたものは
`test/preview-findings.test.ts` に assertion として落としてある —— レポートは読まれなければ効かないが、
テストは落ちる。チェック自体は合格後も残してある。合格したら消すチェックは、コードを 1 回しか検査しない。

初回実行（2026-07-27）は 6 件。

| # | 症状 | 場所 | pin |
| --- | --- | --- | --- |
| F1 | 飽和したバッチの約半分が動けない位置に使われる（実測 0.41 moves/position、26 擾乱でキューは 52 まで膨張） | `domain/falling-block.ts:53-60` / `entities/falling-block-move.ts:167` | — （測定値。上限自体は破られていない） |
| F2 | `retainedLavaFrontier` が `carryOver` の結果に完全に含まれ、両方の doc に従うと溶岩フロンティアが tick ごとに倍増する | `domain/fluid-frontier.ts:62-65`, `:116-122` | ✅ 2 本 |
| F3 | `carryOver` が `key` だけで比較するため、水と溶岩が同座標に並ぶと**未評価の溶岩側**が黙って消える | `domain/fluid-frontier.ts:120` | ✅ 2 本 |
| F4 | fluids stage だけが `Ref.get` → `Ref.set`（DN-GP-10 が禁じる形）。**今日は到達不能**なので形として報告 | `stages/registration.ts:798-805` | — |
| F5 | NaN ダメージ 1 発でプレイヤーが永久に不死になる（`isDead` が永久に false、死亡メッセージが出ない） | `domain/death-cause.ts:110-122` | ✅ 3 本 |
| F6 | 昼夜ルールが日周期でない。範囲外は全部 night で `hostileSpawnsAllowed` も真。負の端数は mc-sim の `% 1` から出る | `domain/day-night.ts:78-98` | ✅ 3 本 |

Mob 用に 3 チェックを足した（2026-07-27）。**finding は 1 件も増えていない。**

| チェック | 何を見るか | 結果 |
| --- | --- | --- |
| 導火線のフレームレート非依存性 | dt を 0.25 / 0.1 / 0.05 / 0.02 / 1/60 / 0.016 と変えて、爆発までの実時間を測る | `[note]`。**1 フレーム以内で一定。**1/60 だけ 91 ステップ（理想 90）で 1.5167 秒になる —— 浮動小数の累積であって tick 数ではない。開始時刻を持てば直るが、それには時計が要る（DN-GP-8 が禁じる） |
| クリーパー縦切り | スポーン判定 → 導火線 → 爆風 → 死因 → ドロップを 1 本で回し、全数値を測る | ✅。`deathMessage()` が `You blew up.` であること（DN-GP-3 の新しい呼び出し地点）と、自爆したクリーパーのドロップが**空**であることを見る |
| スポーンゲートの掃引 | 地面ブロック × 光度の格子を夜と正午で | ✅。葉とガラスが**衝突判定上は solid でも地面ではない**行が見える（kernel 監査 §4.9） |

設置 / ドロップ / 天候用に 3 チェックを足した（2026-07-27）。**finding は 1 件も増えていない。**

| チェック | 何を見るか | 結果 |
| --- | --- | --- |
| ドロップ表の掃引 | 8 ブロック × 5 段の道具、そして fortune / シルクタッチ / 葉のボーナス | ✅。`-` が**空行ではなく拒否**であることが表で読める。finding 条件は「`item:` の上書きを持つ行が自分自身を落とす」—— それが**旧挙動そのもの**であり、画面上は完全にもっともらしく見える |
| 設置の 4 つの拒否 | 溶岩 / 水 / 既存ブロック / 支えの有無を 1 行ずつ | ✅。finding 条件は 2 行だけ: 溶岩セルが `Allowed` でなくなったら、雪の上の松明が `Unsupported` でなくなったら。参照実装が実際に間違えた 1 つ目と、kernel の audit §4.9 が「別々の能力だ」と言っている 2 つ目である |
| 天候の遷移グラフ歩き | シードから 12 回遷移させ、各区間の長さを出す | ✅。**同じ列が毎回出る** —— 参照実装の `WeatherService.tick` は大域生成器を読むので、これは向こうでは書けない検査である |

**F3 / F5 / F6 は当時の 112 本が 1 つも捕まえていなかった。** 理由はそれぞれ違う:

- **F3** —— `test/rules.test.ts` の `carryOver` テストは `key` が全部異なるフロンティアしか使わない。
  `(key, kind)` が 2 対 1 になる入力を書く理由が誰にも無かった。
- **F5** —— 死因テストは全部 `amount: 999` のような有限値を渡す。
  `Damage.amount` に refinement が無いことは型検査も lint も通る。DN-GP-3 が構造で守ったのは
  **cause が消えないこと**であって、**死が起きること**ではなかった。
- **F6** —— `test/day-night.test.ts` は `[0, 1)` の中しかサンプルしない。
  前提条件がどこにも書かれていないので、破る入力を思いつく理由が無い。

これは §3 冒頭の主張の実例である。**型と単体テストが見ない層で起きるバグ**がこのリポジトリの
主要な失敗様式であり、F5 と F6 はどちらも「値としては表現できてしまう不正な引数」、
F3 は「終状態が同じで途中が違う」——3 つとも assertion の端点をすり抜ける形をしている。

### 3-5. 移植が見つけたもの —— F7

§3-4 の 6 件はプレビューが見つけた。**F7 は移植が見つけた**ので番号だけ続けて、
置き場は `test/place-block.test.ts` にしてある（`test/preview-findings.test.ts` は
「`pnpm preview --stats` が測ったもの」であり、F7 はそこを通っていない）。

| # | 症状 | 場所 | pin |
| --- | --- | --- | --- |
| F7 | ~~`canBlockStaySupported` の**per-block アーム**（`block-support.ts:73-89` の `SUPPORT_RULES`）が未移植で、10 種すべてが fallback で答えられている。睡蓮は**水の上で拒否され、石の上で許可される**~~ **→ 解決済み。**kernel が `supportRule` 列を持ったので、`domain/block-vocabulary.ts` がそれをミラーし `placementVerdict` が `canBlockStaySupported` を呼ぶ | `domain/interactions/place-block.ts`（support ブランチ） | ✅ 8 本（**うち 4 本は誤挙動の固定から一致の主張へ書き換えた**） |

**参照実装の `canBlockStaySupported` は 2 本のアームを持つ。**

```
if (!isSupportSensitiveBlock(blockType)) return true
const supportRule = SUPPORT_RULES.get(blockType)
if (supportRule) return supportRule(blockBelow)        // per-block
return !NON_SUPPORTING_BLOCK_TYPES.has(blockBelow)     // fallback
```

移植されたのは fallback だけである。`SUPPORT_RULES` は睡蓮に「水だけ」、サボテンに
「砂かサボテン」、サトウキビに「土/草/砂/サトウキビ」、地表の植物 7 種に「土/草/耕地」を
割り当てており、参照実装ではこの 10 種が fallback に**到達しない**。

**`place-block.ts` のヘッダはこれを判断として記録していない。** 「Only the placement half is
here」が名指しで欠くと言っているのは**維持 sweep** のほうであり、per-block の表ではない。
別途 4 つの設置ルール（キノコの光量・サトウキビの隣接水・サボテンの 4 面・ドア）を
先送りしているが、それは `block-service-place-plan.ts:208-214` という**別の機構**であって
この行を覆わない。

**当時は休眠していた。** 10 種のどれも `PlaceableItemType`（= `ItemType & BlockType`）では
ないので、`placeBlock` から誤った答えに到達できなかった。述語は誤っており、ゲームはまだ
誤っていない、という状態である。

**直さなかった理由は難易度ではなく所有権だった。** 直すには表が要り、kernel のレジストリに
`supportRule` 列が無く（`place-block.ts` が mc-kernel の `PENDING_CAPABILITIES` という
自己申告を引用していた）、ここに書くのは**このリポジトリが kernel のフラグを発明する**ことに
なる。§6 の「持ち込んではいけないもの」と同じ形の判断であり、移植側では決められなかった。

### 3-5-1. F7 は解決した（所有権の問いに kernel が答えた）

**mc-kernel が `supportRule` を実装した**（`mc-kernel/domain/block-support.ts`、監査 §4.6.1）。
異議は覆されたのではなく**答えられた** —— ここが転記しているのは、存在する列である。

| 変えたところ | 内容 |
| --- | --- |
| `domain/block-vocabulary.ts` | `SupportRule` 型・3 つのアーム・`satisfiesSupportRule`・**19 行の override 表を全数**転記。部分ミラーは別の型になるので全数でなければならない |
| `domain/interactions/place-block.ts` | 私有の `SUPPORT_SENSITIVE_BLOCK_TYPES`（14 行）を**削除**。support ブランチは `canSupportAttachments` ではなく `canBlockStaySupported` を 1 回呼ぶ |
| `test/place-block.test.ts` | F7 の 4 本を「誤挙動の固定」から「参照実装の当該行との一致」へ**反転**。各テストが「以前は何を主張していたか」を書いている |

**F7 のテストは自力では赤くならなかった。** これは記録に値する —— 4 本は
`wouldStay` という**再構成**（2 つの述語を AND したもの）を評価しており、規則そのものを
呼んでいなかった。F7 自身の文がそれを予告していた:「A fix that added a per-block table
INSIDE `placementVerdict` and left both predicates alone would not turn these pins red on its
own.」正しかった。再構成は削除し、`canBlockStaySupported` の直接呼び出しにしてある。

**残る隙間も測って書いてある。** 4 本は今や「関数」を固定するが、
`placementVerdict` が**それを呼んでいること**は固定できない。support ブランチを
`canSupportAttachments` に戻しても 53 本すべてが緑のままである（**実際に戻して確認した**）。
理由は同じ壁の一段先で、2 つの綴りが食い違うのは `'oneOf'` 規則を持つブロックだけであり、
**そのブロックは 1 つも置けない**（置ける支持感度ブロック 4 種はすべて `'anySupporting'`）。
`the support branch agrees with the rule on every pair it can be handed` は
`PLACEABLE_ITEM_TYPES` で駆動しているので、10 種のどれかが itemise された日に自動で有効になる。

### 3-6. 移植が見つけたもの —— F8

§3-5 と同じ経路（プレビューではなく移植）なので番号を続ける。置き場は
`test/block-loot.test.ts` で、理由も F7 と同じ —— `pnpm preview --stats` を通っていない。

| # | 症状 | 場所 | pin |
| --- | --- | --- | --- |
| F8 | シルクタッチが**関門**（そもそも落ちるか）としてのみ実装されており、**置換**（何が落ちるか）ではない。参照実装は `item:` の上書きより**ブロックそのもの**を優先する（`block-service-silk-touch.test.ts:52-58`）。この build では石＋シルクタッチが**まるい石**、草ブロックが**土**、グロウストーンが**粉 2 個**を落とす | `domain/block-vocabulary.ts` の `resolveDrop`（= kernel `domain/block-harvest.ts:227-243` の転記） | ✅ 1 本（**現挙動の固定**） |

**kernel が既にこれを書いている**（`mc-kernel/domain/block-harvest.ts:213-220`）。
「KNOWN LIMITATION, recorded rather than faked」と題して置換ではなく関門であることを述べ、
追加的な修正が `silkTouchItem?: ItemType` の 1 メンバであることまで書いたうえで、
**「it is left out until a consumer needs it」**で締めている。

**その consumer が来た、というのが F8 の内容である。** 参照実装のシルクタッチのオラクルが
それであり、条件は満たされた。F7 と違うのは、F7 は**異議**（kernel に列が無い）だったのに対し
F8 は**期限切れの延期**（kernel が「必要になったら」と書いた）である点で、
[porting.md](./porting.md) §4-3-1 の「期限切れの拒否」と同じ形をしている。

**なぜ気付かれなかったか。** 規則が `'self'` のブロック —— 大半 —— では関門と置換が
**同じ関数**である。`test/block-loot.test.ts` の既存のシルクタッチのテストは
ガラス（`'self'` + 関門）と葉（ボーナスの抑制）で、どちらもその側にあった。
`item:` の上書きを持つ行にシルクタッチを掛けたテストは 1 本も無かった。

**ここには直さない。** 表を作るのは kernel の列を発明することであり、F7 が断ったのと
同じ形である（§3-5 の末尾）。pin は §3-5-1 の前例に従う —— kernel が `silkTouchItem` を
生やした日にこのテストが赤くなり、削除ではなく**一致の主張へ書き換える**。

## 4. カバレッジ — 99% ゲートは有効である

**閾値は 4 指標すべてに設定してある。** 参照実装（`takeokunn/ts-minecraft`）と同じ 99% である。

```typescript
// vitest.config.ts
thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
```

実測は **statements 99.75 / branch 99.37 / functions 100 / lines 99.75**（660 テスト、2026-07-28）。
弓とエンダーパールの 4 本は**4 本とも 100 / 100 / 100 / 100** で、`stages/registration.ts` も 100 のままである。
`bow-shot.ts` が一度 97.82 だったのは参照実装の `if (t >= 1) break`（`interaction-bow-handler.ts:81`）を
そのまま移していたためで、**その分岐は算術的に到達不能**（`ceil(d / s) - 1 < d / s`）だったので
テストで覆うのではなく**消した** —— `domain/frame-rolls.ts` の `rollAt` が
「到達しない `?? 0` が 4 つ、どれもカバレッジ報告に永久に赤いまま残る」を理由に同じ処置をしたのが先例である。
この行は一度**古くなっていた**（99.85 / 99.51 と書いてあった）ので、書き直すのではなく測り直した。
インベントリの配線（§3-1 の 1 行目）は 14 本を足して 4 指標のうち branch だけを 99.14 → 99.15 へ動かした ——
`stages/registration.ts` の deposit ループは 2 分岐とも通っており、
`domain/inventory-port.ts` は Tag 1 つ以外に実行文を持たない。
移植 2 回目の 6 本では 4 指標とも動かなかった —— どれも既に到達していた行についての主張だったからである。
レールの 25 本は 4 指標を **99.84 / 99.49 → 99.85 / 99.51** へわずかに動かしたが、それは新しい行が
2 本入って両方 100% だったからであって、**数字を上げるために書いたテストは 1 本も無い**。
その 25 本が何を押さえているかは §3-1 の 5 行目と
[responsibility.md](./responsibility.md) §5-1 にあり、
10 個の変異（曲線と直線の優先順、±1 の傾斜許容、中心セルの前提、同点の行き先、
非有限入力、デッドバンド、そして「速さが答えに届く」項の追加）で全部が赤くなることを確かめてある。

閾値を置かなかった理由は「スケルトンに課しても意味がない」であり、その前提はもう成り立たない。
`domain/` はモブのルール、フレームの sweep、スポーン探索、ドロップ表と支持表、天候と昼夜を持ち、
`stages/` は 2 つのミラーサービスにそれらを配線する 5 つの stage を持つ。
パーセンテージがようやく**実装の挙動についての主張**になった。

`vitest.config.ts` と CI ワークフロー（`Coverage (99% gate)` ステップ）の**両方**で有効にしてある。
閾値は `vitest.config.ts` にしか書かない —— `vitest run --coverage` が自力で非ゼロ終了するので
CI に追加のフラグは要らず、そうしておけば手元と CI が同じ判定をする。
**「push して初めて落ちるゲート」を作らないための配置**である。
なお `pnpm verify` はカバレッジを含まない（`pnpm test` であって `pnpm test:coverage` ではない）。

計測対象は `index.ts` / `domain/**` / `stages/**`。`scripts/` と `test/` は含めない。

### 4-0. 有効化のためにやったこと（テストは 36 本、しかし本題はコードの側にある）

branch は **95.68%** で、未到達は 25 本だった。**そのうちテストを書くべきものは 16 本しか無かった。**

| 分岐 | 判定 | 対応 |
| --- | --- | --- |
| `frame-rolls` の非有限シード / カウント 0 / 0 の不動点 | **本物の抜け**。本文が主張していて誰も確かめていない | `test/frame-rolls.test.ts` |
| `resolveDrop` の「item 形を持たないブロックの `'self'`」 | 本物の抜け。**名前の無いアイテムを鋳造しうる** | `test/block-vocabulary-mirror.test.ts` |
| `blockOfPlaceableItem`（**関数まるごと未実行**） | 本物の抜け。公開面 | 同上（往復で全数） |
| `clampUnit` の非有限アーム | 本物の抜け。`NaN` の countdown は**永久に明けない空** | `test/weather.test.ts` |
| `resolveBlasts` の 6 本（外した爆風、空リスト、bruise、…） | 本物の抜け。slice が作るフレームでは起きない | `test/mob-frame.test.ts`（新設） |
| 光が読めないセル | 本物の抜け。**暗闇と読むと危険な向き**に倒れる | `test/mob-spawn-search.test.ts` |
| `setBlock` の 3 つの結果アーム | 本物の抜け。**しかも既存テストが「ここを通る」と嘘をついていた**（下記） |	`test/place-block.test.ts` |
| offered と searched の連結 | 本物の抜け。人口上限が 1 匹超える経路 | `test/mob-spawn-search.test.ts` |
| `SPAWN_RING_RADIUS_STEPS[i] ?? MIN` | 型が排除済み | 配列を直接回して**削除** |
| `HOSTILE_KINDS[0] ?? EntityKind('creeper')` | 名簿が空のときだけ。定数が排除済み | 型を非空タプルにして**削除** |
| `batch.rolls[n] ?? 0` × 4 | 各呼び出し地点では到達不能。**4 箇所が同じ判断の写し** | `rollAt` に集約して**削除**（残る 1 本は到達可能で試験済み） |
| `withFortune` の `count <= 0` | `resolveDrop` が既に拒否済み。**弱いほうの綴り** | 全域関数にして**削除**（呼び出し側の検査も消えた） |
| 上記 3 件（下の §4-2） | **到達不能** | 呼び出し地点に理由を書いて残す |

**数字のためのテストは 1 本も書いていない。** `exclude` リストも広げていない。

#### 4-0-1. カバレッジが見つけた「嘘をついていたテスト」

`test/place-block.test.ts` に *reports `Unchanged` as Occupied* という緑のテストがあり、
コメントは「同じ石を 2 回書いてこのアームに到達する」と説明していた。**到達していなかった。**
石は replaceable ではないので 2 回目は `isReplaceable` の**読み取り側**で断られ、ストアには届かない。
結果は正しく、経路は書いてあるものと違い、`case 'Unchanged'` の実行回数は 0 だった。
——**通っているテストがあることと、その分岐が試されていることは別である。**
現在は読み取り側の主張として書き直し、書き込み側の 3 アームは
「読みと書きの間で世界が変わった」レースを作るストアで別に固定してある（本文がまさにそう書いている状況）。

#### 4-0-2. mutation が見つけた、カバレッジには見えない穴

全新規テストについて対象コードを壊して赤を確認した（17 個中 16 個が即死）。
生き残った 1 つが本題である: **リングの半径を全ステップ `MIN_SPAWN_DISTANCE_BLOCKS` に潰しても、
このファイルの全テストが緑のまま通った。** 候補数は 64 のまま、帯の検査も通り（16 は帯の中）、
ストア呼び出し数も同じ。実際のゲームでは**モブが常に同じ細いリングにしか湧かない**。
カバレッジ 100% の行だった —— 実行はされていたが、どのアサーションもその値に依存していなかった。
`SPANS the four radii` を足してある。

### 4-1. `domain/position-key.ts` を除外している理由

型エイリアス 1 行だけで、実行可能な文を 1 つも持たないファイルを
v8 provider は 100% ではなく **0%** として報告する。headline の数字が無意味になるため
`coverage.exclude` に入れてある（`vitest.config.ts` の `PURE_TYPE:` コメント）。

このファイルは kernel の座標語彙のプレースホルダであり、kernel publish 時に削除される
（[versioning.md](./versioning.md) §5-1）。除外は恒久措置ではない。

**除外は「測れないもの」に限り、「測ると都合が悪いもの」には使わない。**
ゲートを入れるにあたってこのリストは 1 行も増やしていない。次節の 3 件は、
除外ではなく**呼び出し地点のコメント**として残してある —— 除外は行を報告から消すが、
コメントは読む人の前に残るからである。

### 4-2. 覆っていない 3 本と、その理由（0.51%）

100% ではなく 99% を閾値にしている以上、**空いている分が何なのかを名指しできなければ意味がない**。
3 本あり、いずれも「テストが書けなかった」ではなく「どんな入力でも到達しない」である。

| 場所 | なぜ到達しないか | なぜ消さないか |
| --- | --- | --- |
| `domain/entities/mob-frame.ts` の `offset === undefined` | エンダーマンの**16 回の転移試行が全部外れる**確率。帯は候補正方形の約 74% を覆うので、16 連続の失敗はおよそ**10 億回に 1 回**。他のテレポートテストを駆動している seed 探索（相異なる第 1 ロールを持つ約 12.8 万個）では届かず、どんな予算でも届かない | 死んだコードではない。`endermanTeleportOffset` のオラクルが `undefined` を駆動しており、これはフレーム側がそれを尊重している箇所である。「帯を広げれば必ず見つかる」を拒否しているのがこの分岐 |
| `domain/entities/mob-spawn-search.ts` の `HOSTILE_KINDS[index] ?? HOSTILE_KINDS[0]` | `noUncheckedIndexedAccess` は添字読みを常に `\| undefined` にする。直前の行が `Math.min` で範囲に収めているので、値としては到達しない | 型が要求するので消せない。**2 段あった fallback は 1 段に減らした**（名簿が空である場合を型で排除した） |
| `domain/interactions/place-block.ts` の `UnknownBlock` | `heldItem` は `PlaceableItemType`（= `ItemType & BlockType`）で、`test/block-vocabulary-mirror.test.ts` が `blockIdOf` を **120 の `BlockType` 全部について全域**だと固定している（19 + 101 = 120 の等式）。緑の木では到達しない | mc-kernel が同じ `blockIdOf` の fallback を除外しているのと**同じ形、逆の向き**である。kernel 側は `?? AIR_BLOCK_ID` で「未登録の型が静かに air になる」＝**消滅**する側に倒れる。こちらは**名前のついた拒否**に倒れる。ミラーは kernel の保証が成り立たない場所なので、倒れる向きが正しいほうを残す |

**「到達不能な分岐に入力をでっち上げて覆う」ことはしていない。**
それは将来の読み手に「この分岐は起こりうる」と教えることであり、このゲートが防ぐはずの不正そのものである。

## 5. 決定論

plan.md §5.1-3:

> **クロック注入による決定論**。全シミュレーションが fast-forward 可能

これはテストの都合ではなく、**シナリオテストをオラクルとして使うための前提**である。
同じ入力から同じ出力が出ないなら、参照実装のテストを移植しても答え合わせにならない。

現在このリポジトリが持っている決定論の担保:

| 仕組み | 場所 | 効果 |
| --- | --- | --- |
| 壁時計の直読み禁止 | `scripts/check-dependency-whitelist.ts`（DN-GP-8） | 時刻は注入された Clock Port からしか来ない |
| `dt` は引数 | `StageRegistration.run(dt)` | フレームを好きな速さで進められる。1 ゲーム日を数 ms で回せる |
| 挿入順を保つ `Set` | `domain/falling-block.ts` | 同じイベント列は同じバッチ列を生む |
| 昼夜ルールが全域関数 | `domain/day-night.ts`（DN-GP-7） | 引数以外に依存する値が無い。時刻の**状態**は mc-sim にあり、ここには複製が無い |

`test/stage-registration.test.ts` の
`takeBatch preserves disturbance order, which is what makes a scenario test an oracle` が
3 番目を固定している。順序を保たないコレクションに「改良」すると、
バッチの中身は正しいのに順序が毎回変わり、**シナリオテストが書けなくなる**。

`vitest.config.ts` は `sequence: { seed: 0 }` を指定しており、
テスト自身の実行順もシード固定である。

移植で足すべきもの:

- **シード固定のシナリオテスト。** 「スポーン → 掘る → インベントリを assert」を Node で高速実行する
  （plan.md §3.8 が `mc-sim` について書いている形と同じ）。**半分は済んだ** ——
  `test/vertical-slice.test.ts` の「掘る → 置く → 落ちる」と
  `test/weather.test.ts` の 2 時間ぶんは、どちらも `DEFAULT_ROLL_SEED` から回っていて再現する。
  **残りの半分（インベントリ）も済んだ。** この行は「書く先が無い」と言っていたが、
  それは 2 つの理由のうち片方（`add` が `ItemId = string` を取り、こちらは `BlockId = number` を渡していた）が
  既に消えていたのを見落としていた。`domain/inventory-port.ts` が mc-sim の `InventoryService` を丸ごと写し、
  `gameplay:interactions` が採掘したスタックごとに `add` を呼ぶ。
  `test/vertical-slice.test.ts` の
  `the loot chain reaches mc-sim's inventory` が 1 フレームで
  「掘る → mc-sim が持っている」を assert し、その隣が**満杯のインベントリ**を assert する ——
  `add` が返すのは「入らなかった数」であって成否ではないので、
  これを読み飛ばした stage は**世界の見た目が正しいまま**アイテムを消す。
- ~~**fast-forward。** クロック Port を進めて「1 ゲーム日後に天候が変わっている」を assert する。
  実時間 20 分待つテストは書かない。~~ **済み。** `test/weather.test.ts` の
  `fast-forward: two hours of frames walk the transition graph, reproducibly` が、
  1 秒の `dt` で 7200 フレームを 2 回回して**同じ遷移列**が出ることを assert する。
  クロック Port は要らなかった —— `run(dt)` が delta を引数に取るので、
  「1 秒」は数 µs で済む（§5 冒頭の 2 番目の担保）。天候の値そのものは
  受信箱と送信箱で往復させており、そのループがそのままホストの契約である。

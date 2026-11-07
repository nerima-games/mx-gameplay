# 検証とテスト

## 1. 検証要件

plan.md §3.11 に定める検証は次のとおり。

> **検証**: ルール単位のシナリオテスト + **プレビュー3本**（採掘場: 掘る/置く/ドロップ確認、
> Mobアリーナ: スポーンさせて対峙、時間スライダー: 昼夜/天候）

**テストだけでは完成にならない。** 各リポジトリが単独で正しさを閉じるという構成の前提が
「テスト green + プレビューで目視確認済み」（plan.md §1）だからである。

### 1-1. 3 つの自動検証

`pnpm verify` = `typecheck && lint && test`。CI（`.github/workflows/ci.yaml`）と同じ内容。

`pnpm preview` は `pnpm verify` や CI では実行しない。プレビューは完成条件（§3）なので、手動で操作して確認する。
型検査（`tsconfig.preview.json`）と lint は適用する。

| 検証 | コマンド | 何を捕まえるか |
| --- | --- | --- |
| 型 | `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）、`tsconfig.test.json`（テストとスクリプト）、`tsconfig.preview.json`（端末プレビュー）、`tsconfig.browser.json`（ブラウザデバッグ UI）の**4 つ** |
| lint | `pnpm lint` | `oxlint --deny-warnings src scripts test apps && ast-grep scan`。`no-restricted-imports` が依存ホワイトリスト境界を（`.oxlintrc.json`、DEPENDENCY_POLICY.md §1 の Tier3 許可リスト）、`.ast-grep/rules/no-wall-clock-read.yml` が壁時計直読み禁止を機械検査する |
| 振る舞い | `pnpm test` | vitest |

**依存境界は `no-restricted-imports` で検査する。** 型検査と通常の lint ルールは
`import … from '@nerima-games/mx-ui'` を単体では止められないが、`.oxlintrc.json` の
`no-restricted-imports`（Tier3 許可リスト方式、org 共通 D.9 形式）が禁止パッケージの import に対して
`error` を出す。旧 `pnpm check:deps`（`scripts/check-dependency-whitelist.ts`）と旧 `pnpm api:check`
（`scripts/api-lock.ts`）は org 全体で廃止された（api-lock 機構の廃止、Wave 0 toolchain freeze）。

**oxlint がこのリポジトリ唯一の lint / format 設定である。**
prettier も biome も `.editorconfig` も置かない。整形の権威が 2 つあると
「どちらが正か」の議論が発生し、CI が 2 回走る。

**oxlint と ast-grep は `flake.nix` の devShell から供給される。**
以前は各リポジトリが `package.json` に独自バージョンを固定しており、`no-restricted-imports` を
実装していない oxlint 0.12.x に気づかず滞留する例があった。nixpkgs 由来の単一バージョンに
統一することでこの drift を無くしている。CI（`.github/workflows/ci.yaml`）も
`nix develop --command pnpm lint` で実行する。

### 1-2. 型検査は対象別に設定する

`tsconfig.build.json` は出荷ソースを検査し、`test/**` と `scripts/**` を除外する。
`tsconfig.test.json` はテストとスクリプトを検査し、Node 型を追加する。
`tsconfig.preview.json` は端末プレビューを、`tsconfig.browser.json` はブラウザデバッグ UI を検査する。

`pnpm typecheck` は4つの設定を順に実行する。
個別の設定を確認するときは `pnpm exec tsc -p <tsconfig>` を使う。

## 2. 現在のスイート

現在のテストスイートは 141 ファイル / 2,276 テスト。`nix develop --command pnpm test:coverage` でも 141 ファイル、2,276 テストが成功した。

| テストの種類 | 主な配置 | 役割 |
| --- | --- | --- |
| 単体 | `test/*.test.ts` | ルール、stage、公開 API を個別に検証する |
| 性質 | `test/property/*.property.test.ts` | fast-check で入力範囲を変え、不変条件を検証する |
| シナリオ | `test/scenario/*.scenario.test.ts` | 複数のルールを gameplay stage 経由でつなぐ |
| 再現性 | `test/determinism.test.ts`、`test/weather.test.ts` | 同じ seed から同じ状態・遷移列になることを検証する |
| プレビュー所見 | `test/preview-findings.test.ts` | 測定から得た一部の振る舞いを assertion として固定する |
| 公開契約 | `test/public-api.test.ts`、`test/stage-registration.test.ts` | バレルの export と stage の登録・接続を検証する |

これは 141 ファイルの全一覧ではない。`scripts/verification-catalog.json` が `src/domain/**/*.ts` ごとの検証根拠を記録する。

`test/support/` はテスト資材であり、Vitest の収集対象ではない。`test/support/chunk-store-double.ts` はストアの read / write を数え、`test/support/frame-runner.ts` は stage を順序どおりに実行する。

テストは `@effect/vitest` の `it.effect` を主に使う。`vitest.config.ts` の environment は Node で、`tsconfig.base.json` は DOM 型を含めない。

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

plan.md §8 は次のように定める。

> 参照実装を仕様書として使い、テスト資産を各Stepで**先に**移植する。**ゼロから仕様を再発明しない**

移植対象と選定理由は [porting.md](./porting.md) §4 にまとめてある。オラクルは実装より先に移植する。

### 2-3. ブラウザーシナリオの実行

`pnpm preview:browser` でブラウザデバッグ UI を起動し、シナリオ一覧から確認する ID を選ぶ。
同じシナリオを自動操作するには `pnpm test:browser` を使う。
`pnpm check:catalog` はシナリオ ID と登録を検査するが、シナリオ自体は実行しない。

### 2-4. 検証カタログとシナリオが固定する境界

`scripts/verification-catalog.json` は D-xx 領域と `src/domain/**/*.ts` の対応、単体、性質、決定性、結合、mutation strength、browser scenario の各状態と根拠パスを記録する。
`pnpm check:catalog` は domain ファイルの未記載、重複、欠落と、参照するテストやブラウザーシナリオの存在を検査する。
ブラウザー根拠は `apps/browser-debug/scenarios/` の ID で記録し、領域横断の X-01 から X-08 を含む。
実行手順は §2-3 に記載する。

シナリオで確認する実装境界は次のとおり。

| 項目 | 現在のソース上の境界 |
| --- | --- |
| Craft (X-01) | X-01 はゲームプレイ stage に craft request の経路がなく、Site contract にも craft API がない状態を固定する。InventoryService の構築は mc-sim に委譲している。`apps/browser-debug/scenarios/cross-area.ts` line 171, `src/domain/in-memory-inventory.ts` lines 2-6 |
| Vehicle fire contact (X-04) | FireActorContact の kind は player または entity で、車両の接触経路はない。`apps/browser-debug/scenarios/cross-area.ts` line 431, `src/domain/fire-lifecycle.ts` lines 39-45 |
| Despawn at dawn (X-05) | Mob frame の despawn 判定は距離、age、difficulty、random roll を使うが、時刻や day phase を使わない。`apps/browser-debug/scenarios/cross-area.ts` line 490, `src/domain/entities/mob-frame.ts` lines 1293-1330 |
| Rain shortening fishing wait (X-06) | ルールには雨で wait を短縮する係数があるが、AdvanceFishing の intent は水の有無までしか渡さない。`apps/browser-debug/scenarios/cross-area.ts` line 580, `src/domain/interactions/fishing.ts` lines 121-125, `src/stages/interactions-stage.ts` lines 935-944 |
| Chunk-window refresh (X-07) | openChunkWindow はチャンクを一度読み取って map に保持する snapshot で、blockAt はその map を参照する。移動後の更新 API はこの window にない。`apps/browser-debug/scenarios/cross-area.ts` line 636, `src/domain/chunk-window.ts` lines 187-211 |
| Shield NotDamageable | 採掘道具の結果 schema に EquipmentItem を含む NotDamageable 状態がある。`src/domain/interactions/break-block.ts` lines 106-111 |
| Axe damage | meleeDamageForItem は剣の表にない道具を素手の値にし、axe 固有の攻撃値はない。`src/domain/interactions/melee-attack.ts` lines 42-51 |
| Crossbow | HeldItemCapabilities に item 名はなく、charge の説明は bow を現在扱い、crossbow を将来扱いとしている。`src/domain/interactions/interaction-intent.ts` lines 110-118 |
| Elytra | 防具計算の worn slot は head、chest、legs、feet に限られ、elytra は含まれない。`src/domain/combat/armor.ts` lines 35-60 |
| Fishing rod in Equipment slot | fishing rule は rod を EquipmentItem として受けるが、mc-sim の Equipment catalog は釣り竿を EquippableItemType に含めない。`src/domain/interactions/fishing.ts` lines 48-50, 173-178, `node_modules/@nerima-games/mc-sim/dist/domain/equipment.d.ts` lines 5-15 |

## 3. 完成条件

| # | 条件 | 状態 |
| --- | --- | --- |
| 1 | `pnpm verify` が成功する | 完了 |
| 2 | plan.md §3.11 の 7 領域を実装する | 一部完了。3 領域を実装済み、4 領域は部分実装。内訳は §3-1 |
| 3 | 参照実装のテストを移植する | 一部完了。範囲と未移植の理由は [porting.md](./porting.md) §4 |
| 4 | 採掘場プレビューを操作する | 完了。`pnpm preview --screen site` で掘る、置く、ドロップを確認する |
| 5 | Mob アリーナを操作する | 完了。`pnpm preview --screen arena` で Mob のスポーン、戦闘、ドロップを確認する。ドラゴンは未実装 |
| 6 | 時間スライダーを操作する | 完了。`pnpm preview --screen time` で昼夜と天候を確認する。時刻状態は mc-sim が持つ |
| 7 | coverage の 4 指標すべてに 100% の閾値を設定する | 完了。現行計測は §4 |
| 8 | `mc-kernel` を import し、旧ローカル型ミラーを削除する | 完了。`package.json` が kernel に依存し、ミラーは削除済み |

3 つのプレビューは `pnpm verify` と CI の自動実行には含まれない。plan.md §3.11 の完了確認として手動で操作する。

### 3-1. 責務領域の実装状況

| # | 領域 | 状態 | 現在の実装と残件 |
| --- | --- | --- | --- |
| 1 | 採掘、設置、アイテム使用 | 部分 | 採掘・設置・各アイテム使用ルールは実装済み。弓の遮蔽に使うブロック能力が未提供。 |
| 2 | Mob AI | 部分 | スポーン、戦闘、Mob 固有の状態遷移を実装。ドラゴンは未実装。 |
| 3 | ドロップとルートテーブル | 実装済み | Mob とブロックのドロップを処理する。 |
| 4 | 流体伝播 | 実装済み | `src/domain/fluid-frontier.ts` が予算上限つきの伝播を処理する。 |
| 5 | 乗り物 | 部分 | レール形状と乗り物の運動を実装。駐車中の乗り物などの残件は [responsibility.md](./responsibility.md) §5-5 に記録する。 |
| 6 | ポータルと次元移動 | 部分 | 枠検出、点火、滞在判定、移動先の適用を実装。既存ポータルの再利用には `knownPortals` の所有者が必要。 |
| 7 | 昼夜と天候 | 実装済み | ルールと天候遷移を実装。永続する時刻状態は mc-sim が持つ。 |

責務の割り当てと詳細な残件は [responsibility.md](./responsibility.md) を参照する。

### 3-2. 責務境界

この文書では各領域のテストと検証方法を示す。複数パッケージ間の所有権、未提供のサービス、実装しない理由は [responsibility.md](./responsibility.md) に集約する。

### 3-3. プレビュー 3 本

`pnpm preview` で 3 画面を起動し、`g` で切り替える。画面を指定する場合は `--screen site|arena|time` を渡す。

| 画面 | 操作 | 確認すること |
| --- | --- | --- |
| 採掘場 (`site`) | `b` で掘る、`p` で置く、`t` で道具を切り替える | 採掘・設置ルールとドロップ、インベントリへの反映 |
| Mob アリーナ (`arena`) | 画面の操作で Mob を進める | スポーン、導火線、爆発、死因、ドロップ、テレポート |
| 時間 (`time`) | `.` で時間を進め、`w` で天候を進める | 昼夜判定と天候遷移 |

プレビューは本物の gameplay stage とルールを動かす。画面確認は手動で行う。`pnpm preview --stats` は診断用の測定結果を表示する。

### 3-4. `pnpm preview --stats` の現行 finding

直近の `nix develop --command pnpm preview --stats` は 21 項目を測定し、18 項目が通過、3 件を報告した。統計コマンドは期待値を固定しないため、回帰テストの代わりにはならない。

| Finding | 測定結果 | 状態 |
| --- | --- | --- |
| F0: 待機フレームの読み取り | 5 シナリオで連鎖処理後に 20 待機フレームを回した結果、読み取りは 216〜219 回、書き込みは 0 回 | 読み取り量の診断。フレームごとの内訳は測っていない |
| F1: 落下ブロックの処理予算 | 予算上限に達した 6 フレームで 192 位置を調べ、156 回移動した。予算上限は守られている | 正しさの違反ではなく、位置単位の予算による処理効率の問題 |
| F-mass: 落下ブロックの数量 | 5 シナリオすべてで sand / gravel の数が 1〜6 減少し、インベントリへの格納は 0 件 | 未解決。該当ケースでドロップアイテム実体も観測されず、回帰テストは未追加 |

F-mass は数量保存の不具合を示す。根本原因はこの文書の更新では調べていないため、修正済みとは扱わない。

## 4. カバレッジの結果

`vitest.config.ts` は statements、branches、functions、lines の各閾値を 100% に設定している。CI の `Coverage` ステップは `pnpm test:coverage` を実行する。

`pnpm verify` は coverage を含まない。閾値を確認する場合は `pnpm test:coverage` を実行する。

計測対象は `vitest.config.ts` の `src/**/*.ts`。型宣言、設定ファイル、テストファイルは除外する。

### 4-1. 現行 coverage 結果

`nix develop --command pnpm test:coverage` は 141 ファイル / 2,276 テストを実行した。statements 7,466 / 7,466、branches 4,901 / 4,901、functions 1,367 / 1,367、lines 6,781 / 6,781。計測対象 100 ファイルが完全被覆、空ファイル 1 件が skip され、未被覆ファイルはなかった。

## 5. 決定論

同じ入力とシードから同じ結果を得られることは、シナリオテストを参照実装と比較する前提である。

| 仕組み | 実装 | 確認方法 |
| --- | --- | --- |
| 壁時計の直読みを禁止 | `.ast-grep/rules/no-wall-clock-read.yml` | `pnpm lint` が source の禁止パターンを検査する |
| フレーム経過時間を入力にする | `StageRegistration.run(dt)` | 必要な時間だけフレームを進める。1 ゲーム日も短時間で実行できる |
| 乱数をフレーム内で固定する | `src/domain/frame-rolls.ts` | シナリオを再実行し、同じフレーム列になることを確認する |
| 遷移順を保持する | `src/domain/falling-block.ts` の `Set` | `test/stage-registration.test.ts` が disturbance の順序を確認する |
| テスト実行順を固定する | `vitest.config.ts` の `sequence.seed` | Vitest のテスト順序を固定する |

`dt` はシミュレーションのフレーム時間であり、壁時計ではない。`ClockPort` はホストが時刻サービスを提供するための依存で、フレーム経過時間の代わりではない。壁時計 API を直接呼び出すコードは lint で禁止する。

決定性の例は `test/determinism.test.ts`、`test/weather.test.ts`、`test/vertical-slice.test.ts` にある。`test/weather.test.ts` は 2 時間分のフレームを進め、同じ遷移列になることを確認する。

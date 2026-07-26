# @nerima-games/mx-gameplay

## 責務

**遊びのルール**を持つ。採掘 / 設置 / アイテム使用、Mob AI、ドロップとルートテーブル、流体伝播、乗り物、
ポータルと次元移動、昼夜と天候（plan.md §3.11）。

**状態は一切持たない。** インベントリもエンティティも体力も時刻もチャンクも、実体は `mc-sim` と `mc-worldgen` にある。
このリポジトリが持つのはそれらに対する**動詞**だけである。

## 依存

`mc-sim` / `mc-worldgen` / `mc-audio`。加えて `mc-kernel`（全リポジトリから import 可）。
`mc-playground-kit` は **devDependency 専用**（plan.md §2.3-2）。

これは設計上の制約であり、`pnpm check:deps` で機械的に強制されている
（`scripts/check-dependency-whitelist.ts` の `REPOSITORY_POLICY`）。green のときの出力はこの形になる。

```console
$ pnpm check:deps
check-dependency-whitelist: OK — 13 file(s) scanned, allowed direct dependencies:
@nerima-games/mc-audio, @nerima-games/mc-sim, @nerima-games/mc-worldgen
(plus @nerima-games/mc-kernel, which every repository may import).
```

強制は import だけでは足りない。`after` に書く `StageId` は**文字列**なので import ゲートからは見えず、
`after: [StageId('ui:hud-sync')]` は `pnpm check:deps` を素通りする。この穴は
`test/stage-registration.test.ts` が塞いでいる。2 つのゲートが別の穴を見ている
（詳細は [docs/architecture.md](./docs/architecture.md) §4）。

## このリポジトリの位置づけ

4 階層アーキテクチャの第 3 層、**体験モジュール**（plan.md §2.2）。

- 体験モジュールは互いを知らない。`mx-redstone` / `mx-ui` / `mx-multiplayer` との依存エッジは**ゼロ**である。
  「採掘 → インベントリに入る」は `mx-gameplay` → `mc-sim` の `InventoryService` → `mx-ui` という経路で成立し、
  `mx-gameplay` → `mx-ui` というエッジにはならない（plan.md §2.3-1）。
- 公開しているのは **stage 登録だけ**。サービスは 1 つも公開しない。ルールはサービスではないからで、
  他リポジトリが `mx-gameplay` に尋ねたくなることは、よく見ると全部「状態への問い合わせ」であり、
  状態は `mc-sim` か `mc-worldgen` にある（[docs/public-api.md](./docs/public-api.md)）。
- **16 リポジトリ中もっとも変更頻度が高くなる**（参照実装で 200 commits / 3 ヶ月、plan.md §3.11）。
  それでも**これ以上分割しない**。採掘 / 農業 / 戦闘は共通の stage 契約を共変更する一枚岩であり、
  狭い界面が存在しない（plan.md §5.3）。分割の単位はファイルであってリポジトリではない
  （[docs/responsibility.md](./docs/responsibility.md) §5）。

## ドキュメント

**[docs/README.md](./docs/README.md) が索引。**

| ドキュメント | 内容 |
| --- | --- |
| [docs/architecture.md](./docs/architecture.md) | 4 階層、全 16 リポジトリの依存グラフ、**名詞/動詞ルール**、体験モジュール間エッジがゼロである理由 |
| [docs/responsibility.md](./docs/responsibility.md) | 責務と、**明示的な非スコープ**（どこに行くのかを全部書いてある） |
| [docs/public-api.md](./docs/public-api.md) | 契約は stage 登録だけ。`index.ts` の全 export を 契約 / 内部(可視) に分類 |
| [docs/design-notes.md](./docs/design-notes.md) | **DN-GP-1〜11。** 参照実装で実測された失敗と、それを固定している回帰テストの名前 |
| [docs/porting.md](./docs/porting.md) | 移植元の**実測 LOC**（`wc -l`、2026-07-26 計測）と plan.md 見積との差分 |
| [docs/testing.md](./docs/testing.md) | 検証要件、プレビュー 3 本、99% カバレッジゲートの投入時期 |
| [docs/versioning.md](./docs/versioning.md) | 0.x → 1.0.0 方針、GitHub Packages、このリポジトリにとっての破壊的変更の定義 |

## 依存ルール（16 リポジトリ共通）

| ルール | 内容 |
| --- | --- |
| ハード失敗 | 違反があれば CI は必ず非ゼロ終了する。警告で済ませない |
| 循環禁止 | 循環依存は一切許可しない。「co-evolution ペア」のような例外リストは設けない |
| 推移閉包の禁止 | A→B、B→C のとき A は C を import できない。`mc-sim` が `mc-physics` に依存していても `mx-gameplay` は `mc-physics` を import できない |
| kernel は例外 | `mc-kernel` はどこからでも import 可。**これが唯一の例外** |
| 宣言と実体の一致 | import する `@nerima-games/*` は `package.json` に記載されていなければならない |
| mc-playground-kit は devDependency 専用 | `dependencies` に入れてはならない。実行時依存になると、出荷ビルドから入力処理が消える |
| 壁時計の直読み禁止 | 時刻はすべて注入された Clock Port から取得する |

`scripts/check-dependency-whitelist.ts` は 16 リポジトリ共通のテンプレートである。
書き換えるのはファイル冒頭で囲ってある `REPOSITORY_POLICY` 定数だけで、それ以外はそのままコピーする。
`dependencyGraph` には plan.md §2.1 の全 16 リポジトリが転記されており、
`test/check-dependency-whitelist.test.ts` が roster の非循環性と各ルールを検査している。

### 壁時計直読み禁止の実装方法

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は `oxlint --rules` の一覧に出るが実装されていない（0.12.0 で実測確認済み）。
そのため `Date.now()` / `new Date()` / `performance.now()` の禁止は
**`scripts/check-dependency-whitelist.ts` 側で実装**している。
コメント・文字列リテラル・正規表現リテラルの中身はマスクされるので誤検知しない。
oxlint が該当ルールを実装したら `oxlint.json` 側へ移す。

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0 を用意する（`corepack enable && corepack prepare pnpm@9.15.0 --activate`）。
バージョンは `package.json` の `packageManager` でピン留めしてある。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）/ `tsconfig.test.json`（テスト + スクリプト）/ `tsconfig.preview.json`（`apps/`）の 3 プロジェクトを型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定。prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm preview` | 内蔵プレビュー（採掘場 / 時間スライダー / Mob アリーナ）。**`pnpm verify` には入らない**。[apps/preview-mining-site/README.md](./apps/preview-mining-site/README.md) |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。[docs/testing.md](./docs/testing.md) §4） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + 推移閉包検査 + 壁時計直読み禁止 |
| `pnpm verify` | `typecheck && lint && check:deps && api:check && test`。CI と同じ内容。**`pnpm preview` は含まない** |

## 現状

**実装前の叩き台（pre-implementation first cut）である。** 移植済みのルールは 2 本だけで、
現在あるものの大半は、参照実装で実測された失敗を構造として固定した骨組みと、その回帰テストである。
ただし**縦切り 1 本は通っている** — 掘る → 砂が落ちる → アイテムが渡る、が stage 登録経由で動く。

- **実行時依存は `effect` のみ。** `mc-sim` / `mc-worldgen` / `mc-audio` / `mc-kernel` は
  まだ GitHub Packages に 1 つも publish されていないため、`package.json` に書けない。
  ボトムアップの publish-then-pin（plan.md §6 Step 2）なので、この repo の番は kit の後である。
- **`domain/frame-contract.ts` と `domain/position-key.ts` は kernel 型のローカル再掲であり、削除日が決まっている。**
  mc-kernel が publish された時点で `import type { StageRegistration } from '@nerima-games/mc-kernel'` に置き換えて消す。
  `FrameServices` を `never` にしてあるのが唯一の意図的な乖離で、理由は当該ファイルのコメントにある
  （kernel の `ClockPort` を再掲すると、同じ文字列 ID を持つ**別の** `Context.Tag` が 2 つできる）。
  **この 2 ファイルは `index.ts` から re-export していない。** 所有していない語彙（`StageId` /
  `DeltaTimeSecs` / `StageRegistration`）を公開 API に載せると、約束済みの削除が
  すべての消費者にとっての破壊的変更になるためである。
- **時刻の状態は 1 つも持たない。** `timeOfDaySecs` / `dayLengthSecs` の `Ref` と
  `DEFAULT_DAY_LENGTH_SECS`（1200。mc-sim の 400 と食い違っていた）と `advanceTimeOfDay` は削除した。
  時刻はセーブファイルに要る = 名詞であり、`mc-sim` が所有する（plan.md §2.3-1）。
  ここに残るのはルールのほう —— `domain/day-night.ts` の `isNight` / `dayPhase` /
  `hostileSpawnsAllowed`、すなわち「1 日の位置」だけを引数に取る全域関数である
  （[docs/design-notes.md](./docs/design-notes.md) DN-GP-7）。
- **ブロックの読み書きは配線済み。** `gameplay:interactions` が破壊を、`gameplay:entities` が落下を、
  mc-worldgen の `ChunkStore`（`domain/chunk-store-port.ts` のミラー越し）に対して実際に行う。
  「掘る → 砂が落ちる → アイテムが渡る」の縦切りは `test/vertical-slice.test.ts` が
  **stage 登録経由で**回している。`gameplay:fluids` はキューの出し入れだけ、
  `gameplay:time-weather` は空のままである（mc-sim 待ち）。
  移植済みのルールは 2 本（`domain/interactions/break-block.ts` /
  `domain/entities/falling-block-move.ts`）で、~40 の `interaction-*` ハンドラも Mob AI も残っている。
  何を、どの順で移植するかは [docs/porting.md](./docs/porting.md)。
- **`domain/chunk-store-port.ts` と `domain/block-position-key.ts` も削除日が決まっている。**
  前者は mc-worldgen の `ChunkStore` の**全面**ミラー（狭いミラーはタグキーが同じまま
  メソッドが `undefined` になる静かな実行時ハザードで、`test/chunk-store-mirror.test.ts` が両方向で固定する）、
  後者は kernel の座標語彙との接続点である。どちらもバレルから re-export していない。
- **プレビューは 1 アプリ 3 画面で動く。** `pnpm preview`（[apps/preview-mining-site/](./apps/preview-mining-site/README.md)）。
  plan.md §3.11 が挙げる 3 本に 1 対 1 で対応する `site` / `time` / `arena` を `g` で巡回する。
  ターミナルレンダラであり、`mc-playground-kit` も THREE.js も新規依存も**使っていない**
  （理由は当該 README と `main.ts` 冒頭）。
  **`arena` は「Mob は存在しない」と画面の 1 行目に書く。** 欠けているものを行き先つきで列挙したうえで、
  実在する `domain/death-cause.ts` だけを実際に叩く。スプライトを 2 つ置いて「✅」と書くのは
  穴を進捗に見せることであり、それはしない。
  `pnpm preview --stats` は初回実行（2026-07-27）で **6 件**の finding を出し、
  うち確認できた 4 件は `test/preview-findings.test.ts` に assertion として固定してある。
  3 件（F3 / F5 / F6）は既存 112 本のテストが 1 つも捕まえていなかった。
- **ビルド / publish はまだない。** `tsconfig.base.json` は `noEmit: true`、`package.json#exports` は
  TypeScript ソースを直接指している。`dist` は存在しない（[docs/versioning.md](./docs/versioning.md)）。
- **カバレッジ閾値は未設定。** 計測とレポートは常に動かしており、99% ゲートは完成条件到達時に有効化する
  （`vitest.config.ts` に有効化する行がコメントで置いてある）。
- `pnpm verify` は green。tsc clean（3 プロジェクト）、oxlint 36 ファイル 0 warnings / 0 errors、
  `check:deps` 36 ファイル走査、`api:check` 61 エントリ一致、vitest 9 ファイル 122 テスト pass。
  `apps/` を足しても公開 API は 61 エントリのまま — プレビューは `index.ts` から export されない。

## License

MIT

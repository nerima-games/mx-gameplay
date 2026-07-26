# 検証とテスト

## 1. 検証要件

plan.md §3.11:

> **検証**: ルール単位のシナリオテスト + **プレビュー3本**（採掘場: 掘る/置く/ドロップ確認、
> Mobアリーナ: スポーンさせて対峙、時間スライダー: 昼夜/天候）

**テストだけでは完成にならない。** 各リポジトリが単独で正しさを閉じるという構成の前提が
「テスト green + プレビューで目視確認済み」（plan.md §1）だからである。

### 1-1. 4 つのゲート

`pnpm verify` = `typecheck && lint && check:deps && test`。CI（`.github/workflows/ci.yaml`）と同じ内容。

| ゲート | コマンド | 何を捕まえるか |
| --- | --- | --- |
| 型 | `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト + スクリプト）の**両方**。前者は `types: []` / `lib: ["ES2024"]` なので、Node 型や DOM 型が出荷ソースに漏れた時点で落ちる |
| lint | `pnpm lint` | oxlint。`index.ts domain stages scripts test` の 13 ファイル。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| 境界 | `pnpm check:deps` | 依存ホワイトリスト / 循環 / 推移閉包 / kit の実行時混入 / `Date.now()` |
| 振る舞い | `pnpm test` | vitest |

**このリポジトリで最も重要なのは 3 番目**である。型検査も lint も、
`import … from '@nerima-games/mx-ui'` を止められない。止めるのは `check:deps` だけである
（[architecture.md](./architecture.md) §4-3）。

**oxlint がこのリポジトリ唯一の lint / format 設定である。**
prettier も biome も `.editorconfig` も置かない。整形の権威が 2 つあると
「どちらが正か」の議論が発生し、CI が 2 回走る。

### 1-2. 型検査を 2 回走らせている理由

`tsconfig.build.json` は `test/**` と `scripts/**` を除外する。**除外はここにしかない。**
これが「`mc-playground-kit` は devDependency である」に実効性を与えている —
プレビューハーネスは kit に手を伸ばしてよく、出荷ルールは伸ばしてはいけない（plan.md §2.3-2）。

`tsconfig.test.json` は `types: ["node"]` を足す。**足すのはここだけ**である。
参照実装と違い、テスト向けに strictness フラグを緩めることは一切していない
（`tsconfig.test.json` のコメント: "test code is code, and a skeleton has no legacy to grandfather"）。

## 2. 現在のスイート

**8 ファイル / 112 テスト、全 pass。**

| ファイル | 本数 | 内容 |
| --- | ---: | --- |
| `test/api-lock.test.ts` | 26 | API ロック生成器そのもの（`scripts/api-lock.ts`） |
| `test/rules.test.ts` | 19 | DN-GP-1 / DN-GP-2 / DN-GP-3 のドメイン単体 |
| `test/stage-registration.test.ts` | 19 | フレーム契約（§2.3-1 / §2.3-3）と stage の振る舞い。時刻の `Ref` が無いこと、store を**登録時に**取ること |
| `test/check-dependency-whitelist.test.ts` | 17 | 依存ポリシーそのもの。うち 3 本は**他リポジトリの席から**読んだ roster 検査（§2-3） |
| `test/vertical-slice.test.ts` | 12 | 縦切り。**stage 登録経由で**「掘る → 砂が落ちる → アイテムが渡る」を回す（DN-GP-1 / DN-GP-11） |
| `test/day-night.test.ts` | 8 | DN-GP-7。昼夜**ルール**が何も保持していないこと、mc-sim と夜の定義が一致すること |
| `test/public-api.test.ts` | 6 | `index.ts` のバレルを名前ごと固定する。kernel 語彙と時刻 API の**不在**も固定する |
| `test/chunk-store-mirror.test.ts` | 5 | `domain/chunk-store-port.ts` を mc-worldgen の界面に**両方向で**固定する。タグキーは文字どおり検査する |

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

移植可能なオラクルの実測本数（interaction 33 / Mob 61 / 流体 9 / 落下ブロック 2 / 昼夜 2）は
[porting.md](./porting.md) §4 にまとめてある。**実装より先に移植すること。**

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
| 2 | plan.md §3.11 の 7 つの責務が実装済み | ❌（1 つも未着手。[porting.md](./porting.md)） |
| 3 | 参照実装のテストオラクルが移植済み | ❌ |
| 4 | **プレビュー「採掘場」が操作可能** | ❌ |
| 5 | **プレビュー「Mob アリーナ」が操作可能** | ❌ |
| 6 | **プレビュー「時間スライダー」が操作可能** | ❌ |
| 7 | 99% カバレッジゲートが有効 | ❌（完成時に有効化。§4） |
| 8 | `mc-kernel` を import し `domain/frame-contract.ts` / `domain/position-key.ts` を削除 | ❌（kernel の publish 待ち） |

### 3-1. プレビュー 3 本

plan.md §3.11 が指定する 3 本。`apps/preview-*/` に置く（plan.md §4.1: 「プレビューは契約に含めない」）。

| プレビュー | 確認すること | 主に検証されるルール |
| --- | --- | --- |
| **採掘場** | 掘る / 置く / ドロップ確認 | interaction-*、ドロップ/ルートテーブル、落下ブロック（DN-GP-1）、バケツ経由の流体（DN-GP-2） |
| **Mob アリーナ** | スポーンさせて対峙 | Mob AI、戦闘、死因（DN-GP-3） |
| **時間スライダー** | 昼夜 / 天候 | `domain/day-night.ts` の `isNight` / `dayPhase` / `hostileSpawnsAllowed`（DN-GP-7）、天候遷移。**時刻そのものを動かすのは mc-sim の `TimeService` であり、スライダーはそこへ書く** |

いずれも `mc-playground-kit` を **devDependency として**使う。
kit は「ミニ平地ワールド + カメラ + レンダラ + 入力を 1 秒で束ねる糊」であり、
実行時依存に混ざったら `pnpm check:deps` が落とす（plan.md §2.3-2）。

**なぜプレビューが完成条件なのか。** テストは「決めた通りに動くか」を見るが、
「決めたことが遊びとして正しいか」は見ない。溶岩湖の縁が直線になっていること（DN-GP-2）は
どの assertion にも引っかからず、プレビューを数分動かせば一目で分かる。
参照実装のあのバグが数分後に現れるものだったのは偶然ではなく、**型と単体テストが見ない層で起きるバグ**が
このリポジトリの主要な失敗様式だからである。

## 4. カバレッジ

**現在、閾値は設定していない。これは意図的である。**

- 参照実装は branches / functions / lines / statements の全てに **99%** を強制している。
- しかし**スケルトンに閾値を課しても意味がない**。現在このリポジトリの `domain/` の大半は
  純関数と型宣言であり、型だけのモジュールがいくつかあれば 99% は簡単に満たせてしまう。
  実装の品質について何も語らない数字になり、しかも「もう 99% だから大丈夫」という誤った安心を作る。
- 計測とレポートは常に動かしている（`pnpm test:coverage`）ので、**数字はいつでも見える**。
  CI も毎回 `pnpm test:coverage` を走らせ、`coverage/` をアーティファクトとして 7 日間保存する。

**99% ゲートは完成条件（§3）に到達した時点で、`vitest.config.ts` と CI ワークフローの両方で有効化する。**
`vitest.config.ts` には有効化する行がコメントとして既に置いてある。

```typescript
// thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
```

CI 側にも同じ趣旨の注記がある（`.github/workflows/ci.yaml`:
"Coverage is reported but not yet thresholded — see vitest.config.ts."）。
**2 箇所に書いてあるのは、片方だけ有効にすると「CI は緑だがローカルは赤」になるからである。**

計測対象は `index.ts` / `domain/**` / `stages/**`。`scripts/` と `test/` は含めない。

### 4-1. `domain/position-key.ts` を除外している理由

型エイリアス 1 行だけで、実行可能な文を 1 つも持たないファイルを
v8 provider は 100% ではなく **0%** として報告する。headline の数字が無意味になるため
`coverage.exclude` に入れてある（`vitest.config.ts` の `PURE_TYPE:` コメント）。

このファイルは kernel の座標語彙のプレースホルダであり、kernel publish 時に削除される
（[versioning.md](./versioning.md) §5-1）。除外は恒久措置ではない。

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
  （plan.md §3.8 が `mc-sim` について書いている形と同じ）。
- **fast-forward。** クロック Port を進めて「1 ゲーム日後に天候が変わっている」を assert する。
  実時間 20 分待つテストは書かない。

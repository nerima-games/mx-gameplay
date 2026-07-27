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
| lint | `pnpm lint` | oxlint。`index.ts domain stages scripts test apps` の 46 ファイル。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
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

**18 ファイル / 409 テスト、全 pass。**（`pnpm test` の出力。以前この行は 16 / 373 と書いていた ——
99% ゲートを入れるにあたって 2 ファイルと 36 本が増えた。内訳と、そのうち何本が
「数字のため」ではなかったかは §4 にある）

| ファイル | 本数 | 内容 |
| --- | ---: | --- |
| `test/api-lock.test.ts` | 26 | API ロック生成器そのもの（`scripts/api-lock.ts`） |
| `test/rules.test.ts` | 21 | DN-GP-1 / DN-GP-2 / DN-GP-3 のドメイン単体。流体の予算配分は参照実装の `fluid-tick-budget.test.ts` から 2 本を追加（溶岩は**残り**を取る／有効な lava tick は retain しない）。同ファイルの空入力ケースを**反証できないので消した**理由もここにコメントで残っている |
| `test/mob.test.ts` | 75 | **クリーパー / エンダーマン / シュルカー / 掃除。** 導火線と殻の状態機械を**列挙**し（両方とも全遷移を通す）、爆風の減衰表・スポーン判定・ドロップ・テレポート帯・デスポーン距離を参照実装のオラクルから移植する（§2-2）。乱数がドメインに無いことをソース走査で固定する 1 本と、シナリオ再現を 2 本含む |
| `test/stage-registration.test.ts` | 23 | フレーム契約（§2.3-1 / §2.3-3）と stage の振る舞い。時刻の `Ref` が無いこと、store を**登録時に**取ること |
| `test/check-dependency-whitelist.test.ts` | 18 | 依存ポリシーそのもの。うち 3 本は**他リポジトリの席から**読んだ roster 検査（§2-3） |
| `test/vertical-slice.test.ts` | 34 | 縦切り。**stage 登録経由で**「掘る → 砂が落ちる → アイテムが渡る」「掘る → 置く → 落ちる」「クリーパーが湧く → 爆ぜる → ドロップ」を回す（DN-GP-1 / DN-GP-11）。砂が**水**を、砂利が**溶岩**を貫いて沈む 2 本は参照実装の `falling-block.test.ts:132-152` から。溶岩側は `REPLACEABLE_IDS` の欠落した行の**もう半分**で、これまで何も固定していなかった |
| `test/day-night.test.ts` | 8 | DN-GP-7。昼夜**ルール**が何も保持していないこと、mc-sim と夜の定義が一致すること |
| `test/public-api.test.ts` | 8 | `index.ts` のバレルを名前ごと固定する。kernel 語彙と時刻 API の**不在**も固定する |
| `test/block-vocabulary-mirror.test.ts` | 13 | kernel 語彙のミラー。4 つの能力述語に加え、**`supportRule` の 19 行 override 表を全数**固定する（部分ミラーは別の型なので）。ミラーは転記を固定するだけで、源との比較は mc-dev-meta の `pnpm check:mirrors` である |
| `test/chunk-store-mirror.test.ts` | 7 | `domain/chunk-store-port.ts` を mc-worldgen の界面に**両方向で**固定する。タグキーは文字どおり検査する。`validSpawnSurface` が**負リスト**であること（＝既定 true）もここ |
| `test/preview-findings.test.ts` | 10 | **プレビューが見つけたもの**（§3-4）。うち 8 本は「現在の（誤った）挙動を固定する」テストで、直すと落ちる。**F7 はここではなく `test/place-block.test.ts` にある** —— プレビューではなく移植が見つけたものだから（§3-5）。F7 は**解決済み**で、8 本のうちの 1 つの前例になった：直したときテストは消さず、同じ参照行との**一致**へ書き換える（§3-5-1） |
| `test/entity-manager-mirror.test.ts` | 15 | `domain/entity-manager-port.ts` を mc-sim の界面に固定する |
| `test/mob-spawn-search.test.ts` | 25 | `domain/entities/mob-spawn-search.ts` のリングと、その 256 回のストア呼び出し |
| `test/place-block.test.ts` | 56 | **設置**（§3-1 の 1 行目）。参照実装が**実際に間違えた 3 点**を `REGRESSION:` として持つ —— 溶岩は replaceable、自分の体の中には置けない、支えが要るブロックは支えを見る。`blockOverlapsPlayer` の境界表（`block-service-utils.test.ts:84-98`）は**そのまま移植**してあり、参照実装が同じ関数に持っている**第 2 の表**（`block-utils.test.ts:88-121`、y 軸の排他境界と対角）も移植した。`block-support.test.ts` の支持表は**全行**移植済み —— fallback アームの行と、`SUPPORT_RULES` の行（旧 F7、§3-5-1 で解決）の両方 |
| `test/block-loot.test.ts` | 29 | **ブロックのドロップテーブル**（§3-1 の 3 行目）。kernel の表を通る決定論的な半分と、audit §6-9 がこちらに置いた乱数の半分（fortune / 葉のボーナス）。「素手で石を掘っても何も出ない」が**見た目では気付けないほうの半分**である。ボーナス 4 率（りんご 1/200・棒 2%・苗木 5%・種 1/8）は参照実装から移植 —— **うち 3 つは今日どの表にも載っていない**が、待っているのは kernel の roster 行であって発明ではない |
| `test/weather.test.ts` | 24 | **天候**（§3-1 の 7 行目）。参照実装の `packages/game/test/weather.test.ts` の 8 本を**値を変えずに**移植し、そのうえで参照実装には書けないテスト —— 2 時間ぶんのフレームを回して遷移グラフを歩き、**2 回走らせて同じ列になる**こと（§5 の fast-forward）を足す |
| `test/frame-rolls.test.ts` | 9 | **乱数がフレームに入る場所**（`domain/frame-rolls.ts`）。他のテストは全部 stage 経由で回すので、**生成器が作っていない**シードやカウントについては何も言えていなかった —— 0 が生成器の不動点であること、カウント 0 が種を動かさないこと、`rollAt` が末尾より先を 0 と読むこと。3 つとも本文が主張していて誰も確かめていなかった |
| `test/mob-frame.test.ts` | 9 | `domain/entities/mob-frame.ts` の**フレーム層**。ルール（`domain/mob/`）は `mob.test.ts`、配線は `vertical-slice.test.ts` が持っており、その間が空いていた —— **外した**爆風、爆風ゼロ本のフレームの費用、爆風を生き延びたクリーパーが導火線を保つこと |

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

| 領域 | 状態 |
| --- | --- |
| Mob | 9 ファイル分を `test/mob.test.ts` へ（75 本）。porting.md §4 の表に内訳 |
| 天候 | 参照実装の `weather.test.ts` の **8 本を値を変えずに**（`test/weather.test.ts`） |
| 設置 | `block-service-utils.test.ts:84-98` の境界表 + `block-utils.test.ts:88-121` の**第 2 の表** + `block-support.test.ts` の共有 fallback 行 |
| ブロックのドロップ | fortune 表・葉のボーナス・ボーナス 4 率 |
| 落下ブロック | 液体を貫く 2 本。残りは走査のテストなので**拒否**（porting.md §4-2） |
| 流体 | 予算配分 6 本。`fluid-contact.test.ts` の 7 本は **§3-3 の所有権未決でブロック中** |
| 昼夜 | **移植すべきものが無い。** 参照実装の 29 本は全件が見た目であり mc-render の担当（porting.md §3-4） |

この回に何を移植し何を断ったかは [porting.md](./porting.md) §4-2 に主張単位で表がある。
**移植したものは全件、production を壊して赤を確認してある。**

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
| 2 | plan.md §3.11 の 7 つの責務が実装済み | ❌（**7 分の 3 が実装済み、2 が部分、2 が未着手**。内訳は §3-1） |
| 3 | 参照実装のテストオラクルが移植済み | ❌ |
| 4 | **プレビュー「採掘場」が操作可能** | ✅（`pnpm preview`。plan.md §3.11 が名指しする **3 つとも** —— `b` で掘り、`p` でルールを通して置き、`t` で道具の段を替えると HUD のインベントリが変わる。§3-3） |
| 5 | **プレビュー「Mob アリーナ」が操作可能** | ✅（`--screen arena`。**plan.md §3.11 の 4 挙動のうち 3 つ。** スポーン → 導火線 → 爆風 → 死因 → ドロップ、エンダーマンのテレポート判断と変位、シュルカーの殻、そして掃除が本物。4 つ目のドラゴンは**理由つきの拒否**として画面に載る。§3-3） |
| 6 | **プレビュー「時間スライダー」が操作可能** | ✅（`--screen time`。昼夜と**天候**の両方。時刻を**進める**のは mc-sim であり、そちらは未 publish。天候は所有者が 1 人もいないので画面が持つ —— `domain/weather.ts` の冒頭） |
| 7 | 99% カバレッジゲートが有効 | ✅（`vitest.config.ts` の `thresholds` + CI の `Coverage (99% gate)` ステップ。実測 99.84 / 99.49 / 100 / 99.84、§4） |
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
| 1 | 採掘 / 設置 / アイテム使用 | **部分** | `domain/interactions/break-block.ts` と `place-block.ts` はどちらも本物で、どちらも `gameplay:interactions` から回っている。**アイテム使用が無い**（バケツ・火打石・エンダーパール・弓・農業・ハサミ）。設置の**ブロック別ルール 4 本**（キノコの光量 / サトウキビの隣接水 / サボテンの側面 / ドアの上のセル）も無い —— DN-GP-9 によりそれぞれ別ファイルであり、**先送りであって拒否ではない** |
| 2 | Mob AI | **部分** | `domain/mob/` 7 本 + `domain/entities/mob-frame.ts` で**フレームに配線済み**。4 挙動のうち 3 つ。ドラゴンは §3-3 のとおり**理由つきの拒否** |
| 3 | ドロップ / ルートテーブル | **実装済み** | `domain/mob/mob-drop.ts`（クリーパー / ガスト / ブレイズ、`lootingLevel` 込み）と `domain/interactions/block-loot.ts`。後者は kernel の `drops` / `harvestTool` 列（`domain/block-vocabulary.ts` にミラー）を通る決定論的な半分と、audit §6-9 がこちらに置いた乱数の半分（fortune、葉のボーナス）である。**掘って出るのは「そこにあったブロック」ではなくなった** —— 石はまるい石になり、素手では何も出ない |
| 4 | 流体伝播 | **実装済み** | `domain/fluid-frontier.ts`。plan.md §3.11 が名指しするフロンティア上限つき |
| 5 | 乗り物（ボート / トロッコ / レール） | **未着手** | §3-2 参照。**この行の根拠は間違っていた** |
| 6 | ポータル / 次元移動 | **未着手** | §3-2 参照。結論は正しく、理由が違う |
| 7 | 昼夜・天候 | **実装済み** | `domain/day-night.ts`（`isNight` / `dayPhase` / `hostileSpawnsAllowed`）と `domain/weather.ts`（遷移グラフ・継続時間・`isPrecipitating` / `isThunderstorm` / `weatherLightScale`）。`gameplay:time-weather` は **`Effect.void` ではなくなった**。時刻を**進める**のは依然 mc-sim の `TimeService` である |

**3・4・7 が実装済み、1・2 が部分、5・6 が未着手。**
**1 つも手が付いていない責務は 5 と 6 の 2 つだけ**なのは変わらない。

### 3-2. 未着手の 2 つ —— 旧記述の根拠は**測って間違いだった**

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
状態なので mc-sim のもの —— で、積分は mc-physics のものである。残りの半分はそうではない:

- `resolveRailShape`（`packages/game/domain/rail-shape.ts:18-34`）は
  **1 セルの周囲 4 方向のブロック読みだけ**の全域関数である。速度も名簿も出てこない。
  これは `domain/interactions/place-block.ts` の支え判定や
  `domain/entities/mob-spawn-search.ts` のリングと**同じ形**である。
- `projectMinecartVelocity`（`:39-60`）は速度を**引数に取って**制約したものを返す。
  速度を**生む**関数ではない。これは `domain/mob/enderman-teleport.ts` の
  `endermanTeleportOffset`（変位を返し、着地は呼び出し側が決める）と同じ形であり、
  その形は**このリポジトリで既に受け入れられている**。
- 語彙も揃っている: kernel の `BLOCK_REGISTRY` は `rail`(31) と `powered_rail`(32) を既に持つ。

つまり **`domain/interactions/rail-shape.ts` は今日書ける**。書いていないのは本パスのスコープ外
だからであって、境界に阻まれているからではない。`ARENA_MISSING` にその旨を行として載せてある。

**6（ポータル）。** こちらは着手すべきでないという結論が正しく、**理由が違う**。
参照実装はポータル関連を 1 つ残らず **world パッケージ**に置いている ——
`nether-link.ts` は座標のスケーリング、`portal-frame.ts` は枠の検出とレイアウト生成、
`resolveNetherTravel`（`nether-travel.ts:33-49`）はその合成である。
mc-physics の速度でも mc-sim の名簿でもなく、**mc-worldgen の構造と座標**である。
そして実際に詰まっているのは**誰も持っていない名詞**のほうである:
`Dimension` は kernel のどのファイルにも無く、mc-sim の `EntityState` は 3 フィールドで、
そのどれも「この実体はどの世界に居るのか」を言わない。
**着手する前に所有権を決めるべき 1 行**であるのは変わらない。

### 3-3. プレビュー 3 本

plan.md §3.11 が指定する 3 本。`apps/preview-*/` に置く（plan.md §4.1: 「プレビューは契約に含めない」）。

**実装は 1 アプリ 3 画面である**（`apps/preview-mining-site/`、`g` で巡回）。
`pnpm preview` が入口で、`--screen site|time|arena` でも直接開ける。

| プレビュー | 画面 | 実体 | 主に検証されるルール |
| --- | --- | --- | --- |
| **採掘場** | `site` | **本物**。`gameplayStages` を本物の `ChunkStoreApi` に対して回す | `break-block`、`place-block`、`block-loot`、落下ブロック（DN-GP-1）、`ChunkNotLoaded`（DN-GP-11）。**plan.md §3.11 が名指しする「掘る / 置く / ドロップ確認」の 3 つとも本物である。** `b` は破壊要求を受信箱に積み、`p` は**設置要求を積む**（先にルールへ問い、拒否ならその `_tag` を HUD に出して積まない —— stage は拒否を捨てるので、拒否を見られるのはここだけである）。`t` / `u` / `f` で道具の段・シルクタッチ・fortune を変えると、**次のフレームから出るアイテムが変わる**。`--tool none` と `--tool wooden` の 2 枚は、1 行だけ違う貼り付け可能なフレームである。ストアを直接書く鍵は `e` だけになり、**disturb を呼ばない**ことが設置との対比になっている |
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

## 4. カバレッジ — 99% ゲートは有効である

**閾値は 4 指標すべてに設定してある。** 参照実装（`takeokunn/ts-minecraft`）と同じ 99% である。

```typescript
// vitest.config.ts
thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
```

実測は **statements 99.84 / branch 99.49 / functions 100 / lines 99.84**（409 テスト、2026-07-27）。

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
  残りの半分（インベントリ）は書く先が無い。§3-1 の 3 行目を参照。
- ~~**fast-forward。** クロック Port を進めて「1 ゲーム日後に天候が変わっている」を assert する。
  実時間 20 分待つテストは書かない。~~ **済み。** `test/weather.test.ts` の
  `fast-forward: two hours of frames walk the transition graph, reproducibly` が、
  1 秒の `dt` で 7200 フレームを 2 回回して**同じ遷移列**が出ることを assert する。
  クロック Port は要らなかった —— `run(dt)` が delta を引数に取るので、
  「1 秒」は数 µs で済む（§5 冒頭の 2 番目の担保）。天候の値そのものは
  受信箱と送信箱で往復させており、そのループがそのままホストの契約である。

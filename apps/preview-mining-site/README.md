# preview-mining-site

plan.md §3.11 が mx-gameplay に要求する 2 本目の検証手段
——「**プレビュー3本**（採掘場: 掘る/置く/ドロップ確認、Mob アリーナ: スポーンさせて対峙、
時間スライダー: 昼夜/天候）」——である。
plan.md §6 Step 2 の完了条件は「テスト green **かつ** 内蔵プレビューが操作可能」であり、本アプリがその後半にあたる。

**これはパッケージではない。** plan.md §4.1 のとおり `apps/preview-*/` に置かれた dev アプリであり、
`index.ts` から export されず、他リポジトリから import できない。`pnpm verify` はこれを実行しない。

```console
$ pnpm preview                                   # 対話モード（採掘場）
$ pnpm preview --list                            # シナリオ一覧と、それぞれが何を確かめるものか
$ pnpm preview --stats                           # 数値レポート（下記「見つけたもの」の出所）
$ pnpm preview --once --ascii --break --settle    # 1 フレームを stdout へ（貼り付け用）
$ pnpm preview --once --ascii --view timeline --scenario wide-seam --break --settle
$ pnpm preview --screen time --time 0.28
$ pnpm preview --screen arena
```

## 3 本のプレビューが 1 つのアプリにある理由

`g` で 3 画面を巡回する。plan.md が名前を挙げた 3 本と 1 対 1 である。

| 画面 | 実体 | 何の証拠になるか |
| --- | --- | --- |
| `site` | **本物**。`gameplayStages` を本物の `ChunkStoreApi` に対して回す | `gameplay:interactions` と `gameplay:entities` が動くこと。画面上で動いたブロックは全部 `domain/entities/falling-block-move.ts` が動かした |
| `time` | **ルールドライバとしては本物**。`domain/day-night.ts` の全域関数に引数を掃かせる | `isNight` / `dayPhase` / `hostileSpawnsAllowed` の全域挙動。**時刻を進めることはしない** — 時刻は mc-sim のもの（DN-GP-7）で、`gameplay:time-weather` は `Effect.void` である |
| `arena` | **Mob は存在しない**。画面の 1 行目がそう言う | `domain/death-cause.ts` だけ。欠けているものの一覧を画面に出したうえで、実在する部分を本当に叩く |

**アリーナを描かなかったのは意図的である。** スプライトを 2 つ置いてヘルスバーを付ければ
「Mob アリーナ ✅」と書けるが、それは**穴を進捗に見せる**ことである。
mx-ui のプレビューがインベントリ画面について同じ申し出を断っており、理由も同じである。
代わりにこの画面は、欠けているもの（Mob エンティティ、AI、スポーンルール、近接/遠隔ハンドラ、
ドロップテーブル）を**どこに置くべきかと一緒に**列挙し、実在する死因ルールを実際に叩く。
そこにバグがあった（F5）。

## 何が見えるか

`site` 画面に 3 ビュー（`v` で巡回）。

| ビュー | 何を示すか |
| --- | --- |
| `world` | 断面図。ブロックと、**落下ブロックキューに入っているセル**（網掛け）と、非常駐チャンク（`/`） |
| `queue` | `FallingBlockQueue` の中身を**挿入順**に。予算 32 の線がどこに引かれるか |
| `timeline` | 1 フレーム 1 行のテープ。`pend / exam / move / reads / writes / float` |

**timeline がこのアプリの存在理由である。** `test/vertical-slice.test.ts` はカスケードの
**終状態**と、その前後のストア呼び出し回数を assert する。できないのは**ドレインの形**の assert で、
形は列であり assertion は端点だからである。
「キューが 64 まで膨らんでから減った」と「キューが単調に減った」は、
終状態も終カウンタも同じになる。

`pend` が 0 の行の `reads` が DN-GP-1 の生きたチェックである。参照実装のここの数字は
**1 maintenance tick あたり約 700 万** だった（`domain/falling-block.ts:10-17`）。

`float`（宙に浮いている落下ブロックの数）はカスケード中 0 にならない。
これはバグではなく設計の帰結で、**柱は一体で落ちない**——下から 1 セルずつ抜けるので、
1 セルの隙間が柱を上へ伝わっていく。どの assertion にも掛からず、目で見れば一目である。

## 何が見えないか

- **プレイヤーがいない。** カメラも、視線も、レイキャストもない。`b` は「カーソル位置を壊せ」という
  要求を `pendingBreaks` に入れるだけであり、それは mc-render の input スロット（plan.md §4.2）が
  本来やることである。
- **設置ルールが無い。** `domain/interactions/` には `break-block.ts` しか無い。
  `p` キーはストアを**直接**書き、その旨を HUD に出し、**`disturb` を呼ばない**。
  `domain/falling-block.ts:73-77` は設置を disturb すべき呼び出し側として挙げているが、
  今日それを呼ぶものは存在しない。偽の設置を描くより、**欠けている呼び出しを見せる**ほうが役に立つ。
- **ドロップテーブルが無い。** `Broken.yielded` は「そこにあったブロック」そのものであり、
  ルートテーブルを通っていない。石を掘ると石が出る。
- **流体は伝播しない。** `gameplay:fluids` はフロンティアを回すだけで、伝播ルールは存在しない。
  水も溶岩も**落下ブロックの受け皿**としてだけ登場する（`lava-pit` シナリオ）。
- **Mob がいない。** 上記のとおり。
- **時刻が進まない。** 上記のとおり。

## 見つけたもの

`pnpm preview --stats` は全部**実行時に測定**しており、記録された期待値は 1 つも無い。
直せば finding は自動的に消える。初回実行（2026-07-27）は 6 件だった。
**確認できた finding は `test/preview-findings.test.ts` に assertion として落としてある。**
レポートは読まれなければ効かないが、テストは落ちる。

| # | 症状 | 詳細 |
| --- | --- | --- |
| F1 | **飽和したバッチの約半分は動けない位置に使われる** | 予算は MOVES の名前で POSITIONS に効く。1 move が 2 位置を enqueue する（`below(target)` と `source`）ので、柱の崩落では片方は必ず動けない。実測 0.41 moves/position、26 個の擾乱でキューは 52 まで膨らみ、消えるまで 8 フレーム。**上限自体は破られていない**（超過フレーム 0）ので正しさのバグではない |
| F2 | **`retainedLavaFrontier` が `carryOver` の結果に完全に含まれる** | 両方の doc comment に従って両方を次フロンティアに戻すと、溶岩セルが非アクティブ tick ごとに倍増する（実測 4 → 6 → 12 → 24 → 48 → 96）。`stages/registration.ts:270` は `carryOver` だけを使っており正しい。危険なのは、**死んでいるフィールドの doc が義務のように読める**ことである |
| F3 | **`carryOver` が未評価のセルを黙って捨てる** | フロンティアは `(key, kind)` の集合なのに、`domain/fluid-frontier.ts:120` は `item.key` だけで「評価済み」集合を作る。水と溶岩が同じ座標に並ぶ（＝界面。丸石/黒曜石ルールそのもの）と、**一度も評価されていない溶岩側**がフロンティアから消える。DN-GP-2 が言う「溶岩湖の縁が直線になる」の発生機序そのもの |
| F4 | **fluids stage だけが get-then-set** | `stages/registration.ts:267-270`。同じファイルの `interactions` は `Ref.getAndSet`、`entities` は `Ref.modify` と `Ref.update`（「`set` だと消える」というコメント付き）。DN-GP-10 が禁じている形である。**今日は到達不能**（`fluidFrontier` を書く者が他に無い）ので、観測された喪失ではなく**形**として報告している |
| F5 | **NaN ダメージ 1 発でプレイヤーが不死になる** | `Math.max(0, NaN)` は `NaN`、`NaN <= 0` は `false`。以後 `isDead` は永久に `false` で、`applyDamage` は死者にしか早期 return しないので、次の 1000 ダメージも `NaN` を再生産する。**死因が死亡メッセージに届かない**という DN-GP-3 の失敗様式の 1 段下である（死ぬこと自体が起きない）。`-Infinity` と `Infinity` は正しく処理される。`domain/frame-contract.ts:57` は `DeltaTimeSecs` に `Number.isFinite` の brand を付けている |
| F6 | **昼夜ルールが日周期になっていない** | `isNight(t) = t < 0.25 \|\| t > 0.75` に剰余が無いので、`t` / `t+1` / `t-1`（同じ時刻の 3 日分）で答えが違う。範囲外は**全部 night** になり、`hostileSpawnsAllowed` も真になる。到達経路は負の値で、mc-sim の `(base + elapsed/len) % 1` は JS の `%` が左辺の符号を保つため、**時計が巻き戻ると負の端数を出す** — mx-multiplayer の DN-3 が 1 節を割いている危険そのもの。DN-GP-7 の要点は「mc-sim とこのリポジトリが夜の定義で一致すること」であり、その継ぎ目である |

**F3・F5・F6 は既存 112 本のテストが 1 つも捕まえていなかった。** 理由はそれぞれ異なる:

- F3: `test/rules.test.ts` の `carryOver` テストは `key` が全部異なるフロンティアしか使わない。
  `(key, kind)` が 2 対 1 になる入力を誰も書いていない。
- F5: `test/rules.test.ts` の死因テストは全部 `amount: 999` のような有限値を渡す。
  `Damage.amount` に refinement が無いことは型検査を通り、lint も通る。
- F6: `test/day-night.test.ts` は `[0, 1)` の中しかサンプルしない。
  前提条件がどこにも書かれていないので、破る入力を思いつく理由が無い。

F1・F2・F4 は**正しさのバグではない**。F1 は測定値、F2 は API の罠、F4 は形である。
そう書いてある。

## 制約

- `apps` は `SCAN_ROOTS` に入っている（`scripts/check-dependency-whitelist.ts:262`）。
  したがって import は他のソースと同様にゲートされる。**新規依存は 0 個**——色ライブラリすら足していない。
  `effect` と、このリポジトリ自身のモジュールしか import しない。
- `Date.now()` / `new Date()` / `performance.now()` 禁止も適用される。
  **エスケープハッチ (`mc-kernel-allow-time-source`) は使っていない。** 時計を読む場所が 1 つも無いためである。
  フレームはキー入力で進み、`run(dt)` が dt を**引数**で取るのはまさにそのためである
  （docs/testing.md §5）。`--stats` の `[note]` 行が「dt=0 でも dt=3600 でも結果が同じ」であることを実測している。
- 型検査は `tsconfig.preview.json`（`types: ["node"]`）。
  `tsconfig.build.json` は**触っていない**——出荷ソースが Node 型を持たないという証明はそのまま残る。
- `test/support/chunk-store-double.ts` は**使っていない**。理由は `world.ts` の冒頭にある。

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
$ pnpm preview --once --ascii --screen arena --time 0.9 --spawn --settle
```

## 3 本のプレビューが 1 つのアプリにある理由

`g` で 3 画面を巡回する。plan.md が名前を挙げた 3 本と 1 対 1 である。

| 画面 | 実体 | 何の証拠になるか |
| --- | --- | --- |
| `site` | **本物**。`gameplayStages` を本物の `ChunkStoreApi` に対して回す | `gameplay:interactions` と `gameplay:entities` が動くこと。画面上で動いたブロックは全部 `domain/entities/falling-block-move.ts` が動かし、`b` で掘って出てくるアイテムは全部 `domain/interactions/block-loot.ts` が kernel のドロップ表から出した。`p` は**ルールを通る設置**であり、`i` は**ルールを通るアイテム使用**である |
| `time` | **ルールドライバとしては本物**。`domain/day-night.ts` と `domain/weather.ts` の全域関数に引数を掃かせる | `isNight` / `dayPhase` / `hostileSpawnsAllowed` の全域挙動と、天候の遷移グラフ。**時刻を進めることはしない** — 時刻は mc-sim のもの（DN-GP-7）。**天候は進める** — 進める先が無いからではなく、天候には所有者がまだ 1 人もいないからである（`domain/weather.ts` の冒頭） |
| `arena` | **本物。plan.md §3.11 の 4 挙動のうち 3 つ** | `domain/mob/` の 7 本と、それが到達する `domain/death-cause.ts`。スポーン判定 → 導火線 → 爆風 → 死因 → ドロップ、エンダーマンの意思と変位、シュルカーの殻、そして掃除を実際に叩く。**状態はこの画面が持つ**（mc-sim の役） |

**採掘場は長いあいだ「ドロップテーブルも設置ルールも存在しない」と書いていた。** 両方ある。
`b` で石を掘ると `cobblestone` が出る（素手なら**何も出ない** —— それが `harvestTool` のゲートで、
画面を見ているだけでは気付けないほうの半分である）。`p` は `pendingPlacements` に本物の要求を積み、
stage が `domain/interactions/place-block.ts` を回して、置いた砂は**その場で落ち始める** ——
`domain/falling-block.ts:73-77` が「設置も `disturb` する側だ」と書きつづけていた行の中身である。
`p` が直接ストアを叩いていた頃の注記が予言していたのは正確にそれで、実際に 1 行だった。

**そして採掘場は長いあいだ、動詞を 3 つのうち 2 つしか持っていなかった。** plan.md §3.11 の
責務 1 は「採掘 / 設置 / **アイテム使用**」であり、3 つ目が `i` である ——
`domain/interactions/use-flint-and-steel.ts` を通り、**鍵は 1 つでルールは 2 つ**になっている。
黒曜石（`O`、パレット 7）で枠を組んでその内側で `i` を押すと内部が `%` になり、
壁に向かって押すと `*` になる。**どちらが走ったかは画面が言わない** ——
落とし込み（ポータル → 火）そのものが見せたいものだからで、
これは `p` のように先にルールへ問う dry run が**できない**ことの裏返しでもある:
枠の検出とセルの充填は 1 つのルールなので、2 度問えば 2 度点火してしまう。

**パレットは 14 項目で、`1` から `0` は先頭 10 項目、`[` と `]` は全項目を巡回する。**
`brown_mushroom` / `red_mushroom` / `sugar_cane` / `cactus` / `door` はすべて `p` で
設置規則を通る。キノコは明るさ 12 以下、サトウキビは隣接する水、サボテンは 4 方向の
空き、ドアは上のセルを必要とする。`air` / `water` / `lava` / `nether_portal` / `fire` は
選べても置けない —— `p` が kernel のアイテム形なしという判定を表示する。`door` は
**2 セル**埋める唯一のパレット項目である。

**アリーナは長いあいだ「Mob は存在しない」と 1 行目に書いていた。** 今は 3 体いる。
変わっていないのは**残りを列挙する習慣**のほうで、実装済みの節（7 行）より
missing の節（14 行）のほうが長い。それが正直な比率である —— plan.md §3.11 は 4 種の Mob 挙動を挙げ、
ここにあるのは 3 種で、移植可能な Mob テストは 61 ファイル中 9 本しか来ていない。

**そして missing の節は、実装したことで長くなった。** 「エンダーマン / シュルカー / ドラゴン」
という 1 行が 8 行に分かれている —— ドラゴンの拒否（絶対ワールド Y と速度で書かれているので
ここには書けない）、テレポートの着地点（`y` も地面判定も無い）、シュルカーの弾（正規化ベクトル＝
mc-physics）、装甲式（全防御者が共有するので `domain/combat/` のもの）、射撃間隔、年齢デスポーン、
そして kernel の語彙に無いドロップ名（`ender_pearl` / `shulker_shell`）。
**ルールを書くと、そのルールの縁に名前が付けられるようになる。**

**この画面が mc-sim の役を務めているのが要点である。** `domain/mob/` は Mob を 1 体も持たない。
持っているのは Mob が従う規則で、全部が値から値への全域関数である
（plan.md §7:「状態管理は sim、AI/スポーン/ドロップのルールは gameplay」）。
mc-sim が未 publish なので、この画面が距離 1 つと `CreeperFuse` 値 1 つを持つ ——
**それがルールの側がホストに要求する費用の全部**であり、`screens.ts` の `ArenaCreeper` を読むのが
「このリポジトリが何を所有していないか」を確かめる最短経路である。

時刻は `time` 画面のスライダーから来る。2 つ目の写しを持たないので、
スライダーを正午に置くとアリーナはスポーンを拒否する —— 画面の芝居ではなく規則の動作である（DN-GP-7）。

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
- **流体は伝播しない。** `gameplay:fluids` はフロンティアを回すだけで、伝播ルールは存在しない。
  水も溶岩も**落下ブロックの受け皿**としてだけ登場する（`lava-pit` シナリオ）。
- **Mob は 3 体で、うち 2 体は「決定」だけである。** エンダーマンは跳ぶ**変位**を返すが着地点は返さず
  （`y` が無く、地面判定も無い）、シュルカーは撃ってよいかを返すが弾は撃たない。経路探索も無い
  （クリーパーの距離は矢印キーである）。ドラゴンは**拒否**であって未着手ではない。
  爆発のクレーターも無い —— ブロックを書く別のルールであり、
  `disturb` を呼ばないと砂が宙に浮く。画面がその全部を行き先つきで列挙する。
- **時刻が進まない。** 上記のとおり。

## 見つけたもの

`pnpm preview --stats` は全部**実行時に測定**しており、記録された期待値は 1 つも無い。
直せば finding は自動的に消える。初回実行（2026-07-27）は 6 件だった。
**クリーパーで 3 チェック増えたが finding は増えていない**（1 件は `[note]`:
導火線の長さはフレームレートに対して 1 フレーム以内で一定。1/60 だけ浮動小数の累積で
91 ステップ = 1.5167 秒になる。開始時刻を持てば直るが、それには時計が要る —— DN-GP-8 が禁じている）。
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

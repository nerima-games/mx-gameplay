# 移植

参照実装 `<reference-impl>`（以下 `packages/…` はそのルート相対）から
何を持ってくるか。

## 1. 数値の出所

**本書の LOC はすべて 2026-07-26 に参照実装に対して `wc -l` で実測した値である。**
plan.md §3.11 の数字は見積であり、実測と一致しない箇所がある（§3 に差分を書いた）。
本書の数字を plan.md で上書きしないこと。逆も同様で、plan.md の見積を実測として引用しないこと。

計測条件:

- 非テストのみ（`*.test.ts` / `*.spec.ts` を除外）
- `dist/` を除外
- `node_modules/` を除外

## 2. 移植元と実測 LOC

| 移植元 | ファイル数 | LOC |
| --- | ---: | ---: |
| `packages/app/application/frame/stages/interaction-*.ts`（サブディレクトリ含む） | 40 | 3,317 |
| `packages/entity/domain/mob/` + `packages/entity/application/mob/` | 91 | 4,722 |
| `packages/game/application/day-night-cycle.ts` | 1 | 103 |
| `packages/game/domain/day-night-cycle.ts` | 1 | 87 |
| `packages/game/domain/day-night-cycle-appearance.ts` | 1 | 81 |
| `packages/world/domain/falling-block.ts` | 1 | 95 |
| `packages/world/application/falling-block-maintenance.ts` | 1 | 72 |
| `packages/world/application/fluid-*.ts` + `packages/world/domain/fluid-contact.ts` | 14 | 889 |
| `packages/block/domain/fluid-model.ts` + `fluid-position-utils.ts` | 2 | 143 |
| **合計** | **152** | **9,509** |

補足:

- `interaction-*` のサブディレクトリは `interaction-bucket-handler/` と `interaction-item-use-handler/` の 2 つ。
  40 ファイルはこれらを含む。
- 流体のテストユーティリティ `packages/world/test/fluid-test-utils.ts`（147 LOC）は上表に含めていない。
  `test/` 配下なので非テスト条件で自然に落ちるが、**移植では必要になる**（§5 参照）。
- `packages/world/domain/fluid-contact.ts` はわずか 12 LOC だが、
  溶岩 + 水の接触規則（source lava → OBSIDIAN / flowing lava → COBBLESTONE、`:9-11`）そのものである。
  行数と重要度は比例しない。

## 3. plan.md との差分

### 3-1. Mob: 4,918 と 4,722 の差は 1 ファイル（**両方とも実測値。どちらも誤りではない**）

plan.md §3.11 は `packages/entity` の `mob/` を 4,918 LOC としている。本書の実測は **4,722**（91 ファイル）。
**差の 196 行は `packages/entity/test/mob/test-utils.ts` ちょうど 1 ファイルである。**

```console
$ cd <reference-impl>
$ find packages/entity/application/mob packages/entity/domain/mob \
    -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' | xargs cat | wc -l
4722
$ wc -l packages/entity/test/mob/test-utils.ts
196
# 4722 + 196 = 4918
```

なぜ拾われ方が変わるのか。参照実装は**テストヘルパを `*.test.ts` という名前にしない**
（`test/` ディレクトリに `test-utils.ts` として置く）。したがって
「`*.test.ts` を除く」というフィルタだけでは落ちず、**どのディレクトリを走査したかで結果が変わる**。

| 数え方 | 走査対象 | LOC |
| --- | --- | ---: |
| 実装コードのみ（本書） | `application/mob/` + `domain/mob/` | **4,722**（91 ファイル） |
| `mob` と名の付くもの全部（plan.md §3.11 / mc-sim の porting.md） | 上記 + `test/mob/` | **4,918** |

**移植量として使う値は 4,722 である。** `test-utils.ts` は移植先のテストへ持っていく資産であって
実装コードではなく、本書 §5 で別枠に数えている（流体の `fluid-test-utils.ts` と同じ扱い）。

mc-sim の [porting.md](https://github.com/nerima-games/mc-sim/blob/main/docs/porting.md) §1.1 は
`packages/entity` 全体を 10,865（`test/` ヘルパ 481 行を含む）で数えているため、
そちらでは 4,918 を引くのが正しい。**同じ計数規則の中で首尾一貫していれば、どちらの数字も使える。**
規則をまたいで引き算しないこと。

### 3-2. 「計 ~8.5k」は成立するが、それは流体と落下ブロックを除いた数字である

plan.md §3.11 の「計 ~8.5k」は、次の 3 つの和として整合する。

```
interaction-*        3,317
mob/                 4,722
day-night（packages/game の 3 ファイル）  271
                    ------
                     8,310  ≈ ~8.5k
```

しかし **plan.md §7 のカバレッジ表は「流体・農業・ベッド/睡眠・天候・昼夜」を gameplay に割り当てている。**
流体を含めれば移植量は 8.5k では収まらない。

```
8,310（上記）
  + 889   packages/world/application/fluid-* + world/domain/fluid-contact
  + 167   falling-block（world/domain 95 + world/application 72）
        ------
  9,366
  + 143   packages/block/domain の流体データ型（fluid-model / fluid-position-utils）
        ------
  9,509
```

**~9.4k**（`packages/block` の流体データ型を除く）から **~9.5k**（含む）が実際の移植量である。
§3.11 の見積と §7 の割り当てが食い違っているのであって、どちらかの数字が間違っているのではない。

### 3-3. これは複写ではなく**リポジトリの再割り当て**である

差分の中身をよく見ると、増えた 1,199 行は全部
`packages/world`（= 新構成の `mc-worldgen`）と `packages/block`（= 新構成の `mc-kernel`）に**現在住んでいる**コードである。

| 現在の場所 | 新構成での所有者 | 対象 |
| --- | --- | --- |
| `packages/world/application/fluid-*` | **`mx-gameplay`** | 流体伝播ルール（889 LOC のうち大半） |
| `packages/world/domain/fluid-contact.ts` | **`mx-gameplay`** | 接触生成規則 |
| `packages/world/domain/falling-block.ts` + `application/falling-block-maintenance.ts` | **`mx-gameplay`** | 落下ブロック |
| `packages/block/domain/fluid-model.ts` + `fluid-position-utils.ts` | `mc-kernel` か `mx-gameplay`（要判断） | 流体セルのデータ型と座標ユーティリティ |

**これは「コピーして貼る」作業ではなく、境界を動かす作業である。**
参照実装では流体は「ワールドの一部」として `packages/world` にあった。
新構成では流体伝播は**ルール**なので `mx-gameplay` に来る。ワールドは名詞、伝播は動詞である
（[architecture.md](./architecture.md) §3）。

作業上の含意が 2 つある。

1. **`mc-worldgen` 側の移植担当と衝突する。** `packages/world` を移植する人は
   `fluid-*` と `falling-block*` を持っていってはいけない。着手前に取り決めること。
2. **`packages/block/domain/fluid-model.ts` は判断が要る。** `FluidCell` / `FluidKey` は
   `packages/world/application/fluid-tick-budget.ts:1` が import している共有データ型である。
   複数のリポジトリが読むなら `mc-kernel`、`mx-gameplay` しか読まないならここ。
   `mc-meshing`（`greedy-meshing-fluid-state.ts`）と `mc-render` が水面を描くときに何を見るかで決まる。
   **決めるまでこの 143 行を移植しないこと。** 先に写すと 2 箇所に生えて、後から統合できなくなる。

### 3-4. `packages/core/domain/math/day-night-port.ts`（145 LOC）はここではない

昼夜の移植元を探すとこのファイルに当たるが、**これは Port であって、ルールではない。**
`:1-3` のコメントが自分でそう書いている。

> Structural port for the scene lighting objects manipulated by the day/night cycle.
> Duck-typed — no Three.js import required. Any Three.js objects satisfying this shape will work,
> keeping the application layer free from rendering infrastructure.

横断の Port は `mc-kernel` の資産である（plan.md §4.3）。`mx-gameplay` に持ってくると、
描画オブジェクトの構造型をルールモジュールが所有することになり、
`mc-render` が `mx-gameplay` を見る羽目になる（体験モジュール宛のエッジ）。

`mx-gameplay` が持つのは「今が何時で、それが昼か夜か」を決める部分だけ。
その結果を空の色や光量に変換するのは `mc-render` である。

## 4. 移植の順序 — テストを先に

plan.md §6 Step 2:

> 各Stepで参照実装の対応テスト・fixture・E2Eシナリオを**オラクルとして移植し**、既知バグ（§3各所の設計注意）の再発を防ぐ

plan.md §8 のリスク表も同じことを言っている。

> 書き直しのスコープ（参照実装は 84k LOC + 数ヶ月分のデバッグ知見）→
> 参照実装を仕様書として使い、テスト資産を各Stepで**先に**移植する。**ゼロから仕様を再発明しない**

**実装を先に書くと、仕様を再発明することになる。** 参照実装のテストは数ヶ月分のデバッグの結晶であり、
そこには「なぜこの値なのか」が assertion として固定されている。
先に読めば移植は答え合わせになり、後に読めば作り直しになる。

利用可能なオラクル（実測ファイル数）:

| 対象 | テストの置き場 | ファイル数 |
| --- | --- | --- |
| interaction | `packages/app/application/frame/stages/interaction-*.test.ts`（30）+ `packages/app/test/`（3） | 33 |
| Mob | `packages/entity/test/mob/`（53）+ `packages/entity/test/`（5）+ `packages/entity/domain/mob/` 同居（3） | 61（うち **10 本移植済み**: `creeper-fuse` ×2、`explosion` ×1、`mob-spawner-rules` ×1、`terrain-spawn` ×1、`drop` ×1、`enderman-teleport` ×1、`shulker-behavior` ×1、`entity-manager-utils`（despawn 部）×1 → `test/mob.test.ts`、`mob-spawner-helpers` ×1 → `test/mob-spawn-search.test.ts`。§4-3） |
| 流体 | `packages/world/test/fluid-*.test.ts` | 9 |
| 落下ブロック | `packages/world/domain/falling-block.test.ts` / `packages/world/application/falling-block-maintenance.test.ts` | 2 |
| 昼夜 | `packages/game/test/day-night-cycle.test.ts` / `day-night-cycle-appearance.test.ts` | 2 |

加えて `packages/world/test/fluid-test-utils.ts`（147 LOC）は流体テストの共通 fixture であり、
9 本のテストより先に移植する必要がある。

### 4-1. 上表の 5 つは**ファイル数**である。`it` の本数ではない（2026-07-27 再実測）

**再実測した。5 つとも合っている** —— 列見出しが「ファイル数」である限りは。

```console
$ cd <reference-impl>
$ find packages/app/application/frame/stages -name 'interaction-*.test.ts' | wc -l   # 30
$ ls packages/app/test/interaction-*.test.ts | wc -l                                 #  3   → 33
$ find packages/entity/test/mob -name '*.test.ts' | wc -l                            # 53
$ find packages/entity/domain/mob -name '*.test.ts' | wc -l                          #  3   → 53 + 5 + 3 = 61
$ ls packages/world/test/fluid-*.test.ts | wc -l                                     #  9
$ ls packages/world/*/falling-block*.test.ts | wc -l                                 #  2
$ ls packages/game/test/day-night-cycle*.test.ts | wc -l                             #  2
```

しかし [testing.md](./testing.md) §2-2 はこの 5 つを
「移植可能なオラクルの**実測本数**」と書いていた。**本数ではない。**
同じ 5 つを `it` / `it.effect` の宣言数で数えると桁が変わる:

| 対象 | ファイル数（本表） | **`it` の本数**（実測） | 比 |
| --- | ---: | ---: | ---: |
| interaction | 33 | **402**（stages 380 + `app/test` 22） | 12.2× |
| Mob | 61 | **420 以上**（`test/mob/` 354 + 同居 66、`entity/test/` の 5 本を除く） | 6.9× |
| 流体 | 9 | **94** | 10.4× |
| 落下ブロック | 2 | **19** | 9.5× |
| 昼夜 | 2 | **29** | 9.7× |

**「9 本のオラクルを移植する」と「9 ファイル・94 本を移植する」は別の仕事である。**
本書 §1 が LOC について立てた規則（計数条件を書く、規則をまたいで引き算しない）が
テスト本数には適用されていなかった。testing.md §2-2 を直した。

**「`packages/entity/test/`（5）」だけは再現できない。** 61 = 53 + 5 + 3 は算術としては
合うが、`packages/entity/test/` 直下には Mob 関連のファイルが 5 本より多くある ——
`test/mob/` と重複しないものだけで `dragon-combat` / `dragon-death` / `dragon-healing` /
`dragon-phase` / `enderman-anger` / `enderman-teleport` / `entity-manager-skeleton-shot` /
`explosion` / `explosion-resolution` / `get-mob-definition` の **10 本**が名前で拾える。
どの 5 本を指しているかは本文からは決まらない。**61 という合計は「53 + 3 + 選び方の分からない 5」であり、
他の 4 行と違って再現手順が無い。**

### 4-2. この回に移植したもの（2026-07-27）

実装が先に着地した 3 領域 —— **設置 / ブロックのドロップ表 / 天候** —— と、
既存実装があって未移植だった 2 領域（落下ブロックの液体、流体の予算配分）を、
**主張（claim）単位で**移植した。**27 本追加、346 → 373。**

移植規則: 参照実装の `file:line` を全件に付ける。
**全件について production を壊して赤を確認した**（下表の「反証」列）。

| # | 移植元 | 主張 | 置き場 | 本数 | 反証に使った変異 |
| ---: | --- | --- | --- | ---: | --- |
| 1 | `world/domain/falling-block.test.ts:132-141` | 砂は**水**を貫いて沈む | `test/vertical-slice.test.ts` | 1 | `REPLACEABLE_IDS` から水を外す |
| 2 | 同 `:143-152` | 砂利は**溶岩**を貫いて沈む | 同 | 1 | 同から溶岩を外す |
| 3 | `world/test/block-utils.test.ts:88-121` | `blockOverlapsPlayer` の**第 2 のオラクル表** | `test/place-block.test.ts` | 6 | 半幅を 0.8 / 5 / 6 に、y の `<` を `<=` に、z 軸の半幅を落とす |
| 4 | `world/domain/block-support.test.ts:10-25` | 支持感度と、**fallback を共有する 6 行** | 同 | 9 | `NON_SUPPORTING_IDS` から水 / 感圧板を外す、石を足す、`SUPPORT_SENSITIVE_BLOCK_TYPES` からレール / 感圧板を外す、`ITEM_TYPES` に睡蓮を足す |
| 5 | 同 `:30-32` | ~~F7 —— `SUPPORT_RULES` が未移植~~ **→ 移植済み。**参照実装の 4 行と**一致**する（睡蓮→水、睡蓮≠石、サボテン≠土、苗木≠石） | 同 | 8 | `SUPPORT_RULE_OVERRIDES` の睡蓮行を fallback に戻す、kernel 側の同じ行を戻す、`satisfiesSupportRule` の `'oneOf'` アームに fallback を混ぜる、`ITEM_TYPES` に睡蓮を足したうえで support ブランチを `canSupportAttachments` に戻す |
| 6 | `world/test/fluid-tick-budget.test.ts:55-63` | 溶岩は**残り**を取る（第 2 の半分ではない） | `test/rules.test.ts` | 1 | `budget - waterSliceLength` を `floor(budget/2)` に |
| 7 | 同 `:35-40` | lava tick が**有効**なら retain は空 | 同 | 1 | retain を無条件に |
| 8 | `world/test/block-service-drop-overrides.test.ts:137-142`, `:161-165` | ボーナス 4 率（りんご 1/200・棒 2%・苗木 5%・種 1/8） | `test/block-loot.test.ts` | 2 | 各定数を動かす、`BONUS_DROPS` に 2 行目を足す |

#### 移植を**断った**もの、と理由

| 移植元 | 本数 | 断った理由 |
| --- | ---: | --- |
| `packages/game/test/day-night-cycle.test.ts` | 26 | **全件が見た目である。** `computeDaylightFactor` / `resolveDayNightCycleState` / `computeTerrainSunIntensity` / 太陽弧 / 月の不透明度 / 空色 —— §3-4 が既に決めているとおり、時刻を光量と色に変換するのは `mc-render` である。ここが持つのは「今が夜か」まで（DN-GP-7） |
| `packages/game/test/day-night-cycle-appearance.test.ts` | 3 | 同上。ファイル名が `appearance` と言っている |
| `packages/world/test/fluid-contact.test.ts` | 7 | **本書 §3-3 が禁じている。** `resolveContact` は `FluidCell` を取り、その型は `packages/block/domain/fluid-model.ts` の所有権が未決である（「決めるまでこの 143 行を移植しないこと」）。ここで `FluidCell` を書くと 2 箇所に生える。**所有権が決まり次第、最初に移植すべき 7 本** —— 12 LOC に対して 7 本のオラクルが付いている密度は本書中で最も高い |
| `packages/world/test/fluid-tick-budget.test.ts:14-19` | 1 | **反証できない。** 空入力に対して両方の出力が空になるのは、分類ループを丸ごと削除しても成り立つ。落ちない移植は本数を増やすだけなので消し、理由を `test/rules.test.ts` にコメントとして残した |
| `falling-block.test.ts` の `collectFallingBlockMoves` 8 本 | 8 | **全チャンク走査そのもののテストである**（DN-GP-1）。チャンクバッファの長さ検査・チャンク座標からワールド座標への写像・チャンク跨ぎの走査順は `mc-worldgen` の名詞であり、こちらの API には走査が存在しない |
| `falling-block-maintenance.test.ts` | 7 | 同上。**7 本中 5 本が sweep cursor の挙動**（dirty chunk の即時走査、走査窓の外を飛ばす、cursor を進める）。残り 2 本（支えられた砂利は動かない / 世界の底では動かない）は `test/vertical-slice.test.ts` に既にある |
| `block-service-drop-overrides.test.ts` の GRAVEL → FLINT ほか | 多数 | ブロック名の名指し（§6 の 1 行目）と、**この build の roster に無い品目**（`apple` / `sapling` / `wheat_seeds` / `snowball` / `flint`）。`domain/interactions/block-loot.ts` が各欠落を名指しで記録しており、代替品目での置き換えはしない |
| `block-utils.test.ts` の `canHarvestBlock` 7 本 | 7 | 段の梯子そのものは `test/block-loot.test.ts` にある。**個々の段**（石つるはし→鉄鉱石、鉄→ダイヤ鉱石、ダイヤ→黒曜石）は roster ギャップ —— kernel の表に `iron_ore` / `diamond_ore` / `obsidian` の行が無い |
| `block-utils.test.ts` の `isEffectiveTool` 4 本 | 4 | 採掘**速度**であってドロップではない。破壊進捗の担当（`break-block`）に付くべきで、ドロップ表には付かない |
| `packages/app/test/placement-geometry.test.ts` | — | `adjacentToHit` は「プレイヤーがどこを見ているか」であり、mc-render のレイキャストと mc-sim の姿勢である（`place-block.ts` の「WHAT THIS RULE DOES NOT DO」） |
| `packages/game/test/weather-service.test.ts` の serialize / restore / setWeather | 3 | **状態である。** `Ref` の往復とセーブ復元であり、`domain/weather.ts` 冒頭のとおり天候の値はホストが持つ |

### 4-2-1. 上表の本数と「27 本追加」は足し算が合わない（2026-07-27 再実測）

§4-2 の本文は「**27 本追加、346 → 373**」と書いているが、**同じ節の表を足すと 29 である**
（1 + 1 + 6 + 9 + 8 + 1 + 1 + 2）。差の 2 本がどこから出るのかは本文からは決まらない。

`373 - 346 = 27` は算術として正しく、表の 29 も各行を数えれば正しいので、
**食い違っているのは「追加」の定義のほうである** —— §3-5-1 が記録しているとおり F7 の 4 本は
「誤挙動の固定」から「一致の主張」へ**書き換え**であって新規追加ではない。書き換えを
「追加」に数えるかどうかで表と総数がずれる。どちらの数え方が使われたかは復元できない。

§1 が LOC について立てた規則（計数条件を書く）と §4-1 がテスト本数について直した規則が、
**「追加」という語には及んでいなかった。** 本書で今後この語を使うときは
「新規 `it` の本数」か「変更した `it` の本数」かを明記すること。
なお 373 という当時の総数も現在は再現できない（現在 440、§4-3 と §4-4）。

### 4-3. この回に移植したもの（2026-07-27、2 回目）

前節が着地させた 5 領域のうち、**オラクルが残っていた 3 つ** —— スポーン探索の幾何、
道具の段の梯子、天候の遷移列 —— を主張単位で移植した。**新規 `it` を 6 本追加、409 → 415**
（「追加」＝新規 `it` の本数。既存テストの書き換えは 0 本）。

移植規則は §4-2 と同じ。参照実装の `file:line` を全件に付け、
**全件について production を壊して赤を確認した**。

| # | 移植元 | 主張 | 置き場 | 本数 | 反証に使った変異 |
| ---: | --- | --- | --- | ---: | --- |
| 1 | `entity/test/mob/mob-spawner-helpers.test.ts:6-13` | リングは**一周する** —— cursor 4 が真 +Z、距離 16 | `test/mob-spawn-search.test.ts` | 1 | 角度の `2 * Math.PI` を `Math.PI` に（半周リング）、`cos`/`sin` の入れ替え |
| 2 | `entity/test/mob/mob-spawner-rules.test.ts:18-20` | 探索が出すセルは**3D でも**掃除距離の内側 | 同 | 1 | `feetPosition` の y を +200 に |
| 3 | `world/test/harvestable-blocks.test.ts:33-88` | 段は**真の包含鎖**（各段が下の段を全部含み、かつ真に多い） | `test/block-loot.test.ts` | 1 | `satisfiesHarvestTier` の `>=` を `===` に、石段の行を木段に降格 |
| 4 | `world/test/block-utils.test.ts:58-86` | **段ごとの 4 行**（木→石、石→鉄鉱石、鉄→ダイヤ鉱石、ダイヤ→黒曜石） | 同 | 1 | `HARVEST_TIERS` の `stone` と `iron` を入れ替え |
| 5 | `game/test/weather-service.test.ts:89-113` | 遷移は**保持している天候**から選ぶ（3 連続の満了を歩く） | `test/weather.test.ts` | 1 | `resolveNextWeatherState(state.weather, …)` を `('clear', …)` に |
| 6 | `world/test/block-service-silk-touch.test.ts:52-66` | **移植ではなく乖離の固定**（F8。§4-3-2） | `test/block-loot.test.ts` | 1 | `resolveDrop` に置換アームを足す（＝直す）と赤くなる |

**1・4・5 の変異は、いずれも移植前の 409 本を 1 つも落とさなかった。**
半周リング（モブが常にプレイヤーの前方にしか湧かない）、段の入れ替え
（鉄つるはしが石段のブロックを掘れない）、`advanceWeather` が常に clear から遷移する
（雨が雷にならない）—— 3 つとも走っているゲームでは見えるが、どのアサーションにも掛からなかった。

### 4-3-1. §4-2 が断った理由のうち 1 つは**期限切れだった**

§4-2 は `block-utils.test.ts` の `canHarvestBlock` 7 本をこう断っている:

> **個々の段**（石つるはし→鉄鉱石、鉄→ダイヤ鉱石、ダイヤ→黒曜石）は roster ギャップ ——
> kernel の表に `iron_ore` / `diamond_ore` / `obsidian` の行が無い

**その 3 行は今ある。** kernel の roster 完成で `obsidian`(40) / `iron_ore`(51) /
`diamond_ore`(53) が入り、`domain/block-vocabulary.ts` はそれを転記済みである。
理由が境界でも乖離でもなく**他リポジトリの欠落**だった以上、これは最初から
**終了条件つきの拒否**であり、条件は満たされた。上表の 4 がその移植である。

**理由が成り立たなくなった拒否を誰も見直さないと、誰も下していない決定と区別が付かなくなる。**
本書の拒否表は今後、理由が「他リポジトリの欠落」である行について
**何が来たら再開するか**を書くこと。上の 3 行はそれが書いてあったので気付けた。

### 4-3-2. F8 —— 参照実装が主張し、この build が**違うことをしている** 1 件

`world/test/block-service-silk-touch.test.ts:52-58` は
「シルクタッチは**ブロックそのもの**を落とす（DIAMOND_ORE であって DIAMOND ではない）」
と主張する。**この build は一致しない。**

シルクタッチは**関門**（そもそも落ちるか）としてのみ実装されており、
**置換**（何が落ちるか）ではない。`domain/block-vocabulary.ts` の `resolveDrop` は
kernel の 3 つの拒否を転記していて 4 つ目のアームが無いので、`item:` の上書きが勝つ:

```
石       + silk -> まるい石        （参照実装と vanilla: 石）
草ブロック + silk -> 土            （vanilla: 草ブロック）
グロウストーン + silk -> 粉 2 個   （vanilla: グロウストーン）
```

**kernel が既に書いている**（`mc-kernel/domain/block-harvest.ts:213-220`）:

> KNOWN LIMITATION, recorded rather than faked: silk touch is modelled as a GATE,
> not as a SUBSTITUTION. [...] The additive fix is one optional member
> (`silkTouchItem?: ItemType`) [...] **it is left out until a consumer needs it.**

**その consumer が来た。** 参照実装のシルクタッチのオラクルがそれである。
気付かれなかったのは、規則が `'self'` のブロック——大半——では関門と置換が同じ関数だからで、
`test/block-loot.test.ts` の既存のシルクタッチのテストは全部そちら側だった。

§6 と同じ判断でここには書かない。表を作るのは kernel の列を発明することであり、
F7（testing.md §3-5）が断ったのと同じ形である。**現挙動を参照行つきで固定**してあるので、
kernel が `silkTouchItem` を生やした日にこのテストが赤くなり、
§3-5-1 の前例どおり削除ではなく**一致の主張へ書き換える**ことになる。

### 4-3-3. 残っているオラクルと、断った理由

| 移植元 | 本数 | 断った理由 |
| --- | ---: | --- |
| `world/domain/block-placement-rules.test.ts` | 4 | **移植先が無い。** キノコの光量 / サトウキビの隣接水 / サボテンの側面は testing.md §3-1 の 1 行目が**先送り**にしているブロック別ルール 4 本そのもので、production が 1 行も無い。実装が着地した日に最初に移植すべき 4 本 |
| `world/test/block-service-place.test.ts` の `seedWater` / `seedLava` | 2 | **水と溶岩は置けない。** どちらも `UNITEMISED_BLOCK_TYPES` にあり `PlaceableItemType` ではないので、`placeBlock` に渡す道が型で無い。バケツ（アイテム使用）が来るまで待ち |
| 同 の inventory rollback | 1 | インベントリは mc-sim の名詞。ルールは「何を消費するか」を**報告**するだけ |
| `world/test/block-service-utils.test.ts` の `worldToBlockLocal` 4 本 | 4 | チャンク座標の算術は mc-worldgen の名詞。こちらの API に chunk-local 座標が存在しない |
| 同 の `BlockServiceError` 3 本 | 3 | エラー配管である。`StageRegistration.run` の error channel は `never` なので、対応する型が無い |
| `world/test/block-service-drop-overrides.test.ts` の `NON_PLACEABLE_ITEM_TYPES` 完全性 | 1 | **主張が消える。** 参照実装のこのガードは手書きのリストが漏れることを防ぐもので、こちらの `PLACEABLE_ITEM_TYPES` は `ITEM_TYPES.filter(isPlaceableItem)` と**導出**されている。導出に完全性ガードを掛けても構成上真であり、何も固定しない |
| 同 のブロック名を名指す行（`GRAVEL → FLINT` ほか） | 多数 | §6 の 1 行目。§4-2 と同じ |
| `entity/test/mob/mob-spawner-helpers.test.ts` の `selectMobType` 2 本 | 2 | **意図的な乖離。** 参照実装は 8 種の名簿を**カーソル**で回す（round-robin であって重み付けではない）。カーソルは世界ごとの状態なので mc-sim のもので、`domain/entities/mob-spawn-search.ts` は一様なロールを引く —— ファイル冒頭に理由つきで書いてある |
| `entity/test/mob/terrain-spawn.test.ts` の残り 6 本 | 6 | 8 本のうち光量の境界 2 本（7 は湧く / 8 は湧かない）は §4-2 以前に移植済み。残りの内訳: **列走査 3 本**は意図的な乖離 —— 「上から最初の非空気ブロック」を Y にする走査は `domain/mob/hostile-spawn.ts` が避けるために書かれたバグそのもの（葉とガラスが地面になる）で、`mob-spawn-search.ts` の「ONE PLANE, NOT A COLUMN SCAN」節が代償込みで書いてある。**非敵対スポーン 1 本**は移植先が無い（こちらの規則は敵対専用）。**chunk-local の折り返し 1 本**は mc-worldgen の座標。**残り 1 本は反対の乖離**（下記） |
| `game/test/weather-service.test.ts` の残り 4 本 | 4 | 単一遷移の主張であり、`game/test/weather.test.ts` の 8 本として既に移植済み。同じ主張を 2 回数えない |
| `world/test/harvestable-blocks.test.ts` の名指し行（`CAULDRON` / `GOLD_PICKAXE` ほか） | 多数 | §6 の 1 行目、および roster ギャップ。段の**形**だけが移植可能で、それが上表の 3 |

#### 反対向きの乖離 —— 「光が読めないセル」

`terrain-spawn.test.ts:62-66` は「`blockLight` グリッドが**無ければ 0（暗い）と読む**」——
つまり**湧く**——と主張する。**こちらは逆に倒してある。**
`test/mob-spawn-search.test.ts` の
`a cell whose BLOCKS read but whose LIGHT does not is unreadable, not dark` が
「読めなかったセルは `unreadable` に数えて提供しない」を固定している。

F8（§4-3-2）と同じく参照実装と食い違うが、**向きが逆で、こちらは意図してそうしている**:
参照実装の読みは「測れなかった」を「真っ暗」と同一視するので、
**昼間の地上にモブを湧かせる**側に倒れる。`domain/mob/hostile-spawn.ts` の `unmeasurable` と
プレビューの finding F5 が同じ形の判断である。移植しないこと自体が主張なので、ここに記録する。

#### 決めるべき 1 行 —— `rollGrassSeedDrop`

`test/block-loot.test.ts` の「the three unshipped lines really are unshipped」は
**自分でこう書いている**:

> 種の行は名指す `wheat_seeds` が無かった。**今はある** —— kernel の roster 完成で入った。
> だから**その半分はもう kernel のギャップではない**。`rollGrassSeedDrop`（`:245-246`）の移植は
> このリポジトリがいつやってもいい仕事であり、audit §6-9 は乱数のドロップ規則をこちらに置いている。

つまり `world/test/block-service-drop-overrides.test.ts:144-165` の 4 本は**移植可能**である。
**しかし移植すると同じファイルの既存テストと衝突する** —— そのテストは
「tall_grass と fern はどんなに運が良くても何も落とさない」を現状として固定しており、
`BONUS_DROPS` に行を足すと赤くなる。

**これはテストの移植ではなく production の変更を要求する決定であり、片方を黙って直さない。**
決めるべきことは 1 つ:「ベースドロップが無いブロック（`UNITEMISED_BLOCK_TYPES` にある
tall_grass / fern）にボーナス行だけを持たせるか」。葉が先例で、答えは「持たせてよい」に見えるが、
葉は**アイテム化されている**ブロックである。この行を決めるまで両方を現状のままにしてある。

## 5. 推奨する着手順

依存の少ないものから、かつ**プレビューで確認できる単位で**閉じる（plan.md §6 Step 2 の「テスト green + プレビュー操作可能」）。

| 順 | 対象 | LOC | 閉じるプレビュー | 備考 |
| ---: | --- | ---: | --- | --- |
| 1 | 昼夜（`packages/game` の 3 ファイル） | 271 | 時間スライダー | 依存が最も少ない。**ここに移植するのはルールだけ**——`domain/day-night.ts` の `isNight` / `dayPhase` / `hostileSpawnsAllowed` が既にある（DN-GP-7）。時刻の**状態**（tick カウンタ・日長・`advance`・順序ハザード）は `mc-sim/domain/time-of-day.ts` の担当であり、ここには移植しない |
| 2 | 落下ブロック | 167 | 採掘場 | `domain/falling-block.ts` の骨組みが既にある（DN-GP-1） |
| 3 | 流体 | 889 (+143 要判断) | 採掘場（バケツ） | `fluid-test-utils.ts` を先に。境界移動の調整が要る（§3-3） |
| 4 | interaction-* | 3,317 | 採掘場 | 40 ファイル。1 ルール 1 ファイルを維持（DN-GP-9） |
| 5 | Mob | 4,722 | Mob アリーナ | 最大。`mc-sim` の `EntityManager` が実在してから。**ただしルールの半分は先に来られた** —— §5-1 |

### 5-1. クリーパーは `EntityManager` を待たずに移植できた（実測）

上表は Mob を最後に置き、理由を「`mc-sim` の `EntityManager` が実在してから」としている。
**半分は正しく、半分は間違っていた。**

移植不能なのは Mob の**状態**を要求する部分である —— 名簿の反復、個体数上限、デスポーン、
経路探索、そして「Mob AI stage」そのもの。これらは全部 mc-sim の名詞を読む。

移植できるのは**ルール**の部分であり、それは値から値への全域関数として書ける。
実際に `domain/mob/` の 7 ファイルは `EntityManager` を 1 度も名指ししていない:
導火線は `(CreeperFuse, 距離, dt) -> (CreeperFuse, 爆発?)`、
スポーン判定は `(候補セル) -> 可否`、ドロップは `(規則, 死に方, ロール) -> 品目`、
テレポートは `(3 つの事実) -> 意思` と `(ロール列) -> 変位?`、
シュルカーの殻は `(ShulkerShell, 4 つの事実) -> (ShulkerShell, 射撃可否)`、
掃除は `(距離, 常駐か) -> 可否`。
ホストが誰であるかを知らないので、テストとプレビューがホストを務められる。

含意は移植順そのものにある。**「mc-sim 待ち」と書かれた行は、名詞を要求する部分だけが待っている。**
着手前に「この行のどこが状態でどこがルールか」を分けると、待たずに済む分が出てくる。

### 5-2. 残り 3 種のうち 2 種は割れた。ドラゴンは割れない（実測）

§5-1 は「テレポート先の探索は世界を読むので、クリーパーほどきれいには割れない見込み」と書いた。
**その見込みは外れた。** 参照実装の `computeEndermanTeleportTarget` は
エンダーマン自身の位置を使っておらず（`enderman-teleport.ts:28` の `_position`）、
候補を `targetPosition + offset` で作って**その `targetPosition` に対して**距離を検査するので、
位置が約分されて**変位だけ**が残る。`domain/mob/enderman-teleport.ts` はその変位を返す。
参照実装のオラクルの期待値と桁まで一致するので、割ったことで失ったものは無い。

シュルカーの殻（`domain/mob/shulker-shell.ts`）はもっと単純で、導火線と同じ形である。
デスポーン（`domain/mob/hostile-despawn.ts`）も距離 1 つと旗 1 つに落ちた。

**ドラゴンだけは割れない。** 位相機械（`ender-dragon/dragon-phase.ts`）の分岐は
`TAKEOFF_COMPLETE_Y = 80` / `LOW_ALTITUDE_Y = 70`（:51-52）という**絶対ワールド Y** で切り替わり、
各位相は**速度**を返す（:89-109）。絶対高度はジ・エンドの黒曜石柱という**構造の事実**（mc-worldgen）、
速度は**移動**（mc-physics）である。ここに書けるのはそのどちらでもないので、書かない。
アリーナの missing 一覧に、理由つきの**拒否**として載せてある。

4 と 5 は `mc-sim` の公開 API に強く依存する。plan.md §3.8 が
「この公開 API が全下流の依存先（=最重要界面）」と書いているとおりで、
`mc-sim` の界面が揺れている間に大量移植すると、揺れるたびに 8k 行を追随させることになる。
1〜3 で界面の当たりを取ってから 4・5 に入るのが安い。

## 6. 移植時に持ち込んではいけないもの

| 参照実装にあるもの | 理由 |
| --- | --- |
| ブロック名の名指し判定（`=== 'SAND'` / `blockTypeToIndex('SAND')`） | 挙動判定は `mc-kernel` の能力フラグ参照に統一する（plan.md §3.1、§5.1-1）。mc-kernel `docs/capability-flag-audit.md` §2-3 の実測で、名指し判定と membership テーブルの和集合は **78 ファイル**に散っていた |
| `Date.now()` / `new Date()` / `performance.now()` | DN-GP-8。`pnpm check:deps` が落とす |
| 「全チャンク走査」の類 | DN-GP-1。API に存在しないので書けないが、移植中に足さないこと |
| 右クリック UI ルーティング（`interaction-right-click-target-routing.ts:12-27`） | 画面の選択は `mx-ui` の意味論。ここが持つのは `interactionId` まで |
| アプリスコープのシングルトン | DN-GP-6 |
| **保存済みの数値を再判定する「爆発」**（`entity-manager-creeper-detonation.ts:19` の `fuseSecs >= 1.5`） | 参照実装は導火線 tick が返す `detonate` を捨て（`entity-manager-update-maintenance.ts:36`）、別ファイルで数値を再判定する。その結果「爆発は 1 回だけ」を担保しているのは 3 つ目のファイルの `HashMap.remove`（`entity-manager-combat.ts:60`）であり、削除を外した個体は毎フレーム爆発する。加えて再判定には距離検査が無いので、**導火線が満了した後は逃げても助からない**（燃焼中のキャンセルと矛盾する）。`domain/mob/creeper-fuse.ts` は爆発を**遷移**にし、`Detonated` を終端にしてある |
| `Math.random()` を呼ぶドロップ経路（`interaction-melee-handler.ts:185` / `interaction-mob-drops.ts:18`） | 参照実装のドメインは純粋だがアプリ層がグローバル乱数を読むため、**ドロップは再現できない**。plan.md §5.1-3 の決定論はシナリオテストをオラクルにするための前提なので、ロールは引数で通す（`domain/mob/mob-drop.ts`） |
| **ハードコードされたロール**（`entity-manager-damage-enderman.ts:14` の `shouldEndermanTeleport(true, 0, 0)`） | `0 < 0.3` は常に真なので、`DAMAGE_TELEPORT_CHANCE = 0.3` は**一度も走っていない**。被弾したエンダーマンは毎回テレポートする。定数が挙動ではなく意図の記録になっている典型で、`test/mob.test.ts` が両側の境界を固定して復活させてある |
| **1 つのロールを 2 つの判断に使い回すこと**（`entity-manager-ai-enderman-teleport.ts:25` が `frame.randomWanderRoll` を渡す） | 同じ乱数が徘徊方向の再抽選（`WANDER_REDIRECT_PROBABILITY = 0.2`）とテレポート（0.05）を決めるので、**テレポートするフレームは必ず徘徊も切り替わる**。ロールを引数にすると、この相関はホスト側で見えるようになる |
| **`isInvulnerable` フラグ**（`shulker-behavior.ts:54`） | 同じファイルの `computeShulkerShellDamage` は閉殻に 20% を通す（20 点＝80% 減）。フラグを読んだ呼び出し側が先に来れば Mob が不死になる。`domain/mob/shulker-shell.ts` は**装甲点数だけ**を報告し、フラグは持ち込まない |
| **消費者も生産者も無い定数**（`SHULKER_FORCED_CLOSED_TICKS = 100`、`shulker-behavior.ts:9`） | 参照実装でもテストでも 1 度も参照されず、門番をする `closeTicksRemaining` に生産者も減算も無い。移植すると**両端を発明する**ことになるので、アリーナの missing 一覧に「未決」として置く |
| **ヴィラジャーを名指しする despawn 免除**（`entity-manager-utils.ts:66` の `type === 'Villager'`） | ブロック名の名指しと同じ話（上の行）。`domain/mob/hostile-despawn.ts` は `persistent` という**旗**を受け取り、誰が常駐かは名簿が決める |
| THREE.js に触るもの | `tsconfig.base.json` の `lib: ["ES2024"]` / `types: []` が型で拒否する |

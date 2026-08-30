# バージョニングと公開

## 1. 現状

- **バージョン: `0.3.1`。**
- **build / publish パイプラインが Wave 0（org 全体のツールチェーン凍結）で追加された。**
  `package.json` の `exports` は `dist/index.js` を指し、`tsc -p tsconfig.release.json` が
  `scripts/clean-dist.mjs` に続けて emit する。`.github/workflows/release.yaml` が
  `main` へのバージョン変化を検知して GitHub Packages へ publish し、tag を打つ。
- **`@nerima-games/*` への実行時依存は `mc-kernel` / `mc-sim` / `mc-worldgen` / `mc-audio` の 4 本。**
  4 リポジトリとも Wave 0 で dist 付き publish 済みになったため、`dependencies` に exact pin で書ける
  （§5 のボトムアップ publish-then-pin 順）。

## 2. 0.x に留める方針

**下流リポジトリ（`mc-compose`）が実際に契約を消費して確認するまで、`0.x` から出ない。**

plan.md §6 Step 3(のちに RELEASE_STANDARD.md §4.2 が正式なポリシーとして上書き。日数計測の自動凍結ゲートは廃止済み):

> 界面が安定したリポジトリから GitHub Packages 等へ npm 公開 + changesets 運用に切り替える。
> 「安定した」の判定は自動ゲートではなく maintainer の裁量判断による([RELEASE_STANDARD.md §4.2](../../.github/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断))。
> それまでは dev-meta workspace 統合で開発。

plan.md §8 のリスク表も同じことを別角度から書いている。

> **新規構築初期は全界面が高churn** → npm公開を遅らせ dev-meta workspace で開発。bump連鎖を構造的に回避

**`1.0.0` は機能の完成度についての宣言ではなく、界面が実際に使われたことについての宣言である。**
`mx-gameplay` の公開界面は `StageRegistration` の配列 1 つだけなので、
机上では今日にでも凍結できる。凍結してよいかどうかは、`mc-compose` が
4 モジュールの登録をマージして全順序を解いてみるまで分からない。
そこで初めて「`after` を 1 本しか宣言していないのは足りていたか」が判明する。

## 3. 公開先

**GitHub Packages**（`https://npm.pkg.github.com`、`access: public`）。packages が public 化済みのため
`restricted` のままだと新規 publish が private に戻り下流 CI が 403 になる（org 全体のポリシー）。

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "public"
}
```

`.npmrc` の `@nerima-games:registry=https://npm.pkg.github.com` が `@nerima-games/*` の依存解決先を
GitHub Packages に固定する。認証トークンは CI では `.github/workflows/ci.yaml` / `release.yaml` の
「Configure GitHub Packages authentication」ステップが、手元では `NODE_AUTH_TOKEN=$(gh auth token)` が渡す。

## 4. build / publish パイプライン（Wave 0 で追加済み）

`docs/testing.md` §3 の完成条件と独立に、org 全体のツールチェーン凍結（Wave 0）で以下が入った。

1. `tsconfig.release.json` を新設し、`node scripts/clean-dist.mjs && tsc -p tsconfig.release.json` で
   `dist/` を生成する（`tsconfig.build.json` / `tsconfig.test.json` / `tsconfig.preview.json` は
   引き続き check-only のまま — ビルド成果物を介すと型エラーがビルド時にしか出ず、
   16 リポジトリを 1 つの workspace で開発する間の DX が落ちるため、型検査とビルドを分けている）
2. `package.json` の `main` / `types` / `exports` を `dist/` に向ける
3. `files` から `src` / `tsconfig.base.json` を外し `dist` / `LICENSE` / `README.md` にする
4. `.github/workflows/release.yaml` を追加する（`main` への push トリガ。version 変化を検知して publish、
   `workflow_dispatch` での手動再実行にも対応）
5. `scripts/verify-package.mjs` で packed tarball をクリーンな consumer から import し、
   `pnpm package:verify` として CI とローカルの両方でゲートする

## 5. ボトムアップの publish-then-pin

plan.md §6 Step 2 の構築順がそのまま publish 順になる。

```
kernel
  → noise / meshing / physics / save / audio（並行可）
    → worldgen
      → sim
        → render
          → playground-kit
            → gameplay / redstone（並行可）   ← ここ
              → ui
                → multiplayer
                  → compose
```

**`mx-gameplay` の番は 7 段目である。** それまでは `mc-dev-meta` workspace（plan.md §6 Step 0）で
`workspace:*` 解決により開発する。`repos/` に 15 リポジトリを clone して 1 つの pnpm workspace として束ねる薄いリポジトリで、
モノレポ同等の DX を得ながらリポジトリ分割を保つ仕組みである。

npm 公開は maintainer が「界面が安定した」と裁量判断するまで開始しない（plan.md §6 Step 3、
[RELEASE_STANDARD.md §4.2](../../.github/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断)）。
日数計測ベースの自動凍結ゲートは採用しない。高 churn な初期に publish を始めると、
kernel の 1 行修正が 7 段の republish カスケードを引き起こす。

### 5-1. `domain/frame-contract.ts` と `domain/position-key.ts` の削除

この 2 ファイルは `mc-kernel` の型（`StageRegistration` / `StageId` / `DeltaTimeSecs` / `FrameServices` / `Position` の鍵表現）の
**ローカル再掲**であり、削除日が決まっている。

```typescript
// mc-kernel が publish されたら、これに置き換えて 2 ファイルを消す
import type { StageRegistration } from '@nerima-games/mc-kernel'
```

**この削除自体は semver-MINOR の内部変更である。** 消えるのは型の**実装**であって、
`index.ts` から見える名前と形は変わらない（`FrameServices` が `never` から `ClockPort` に広がるだけで、
stage 作者にとっては非破壊 — `Effect<void, never, never>` は
`Effect<void, never, ClockPort>` が要る位置に代入できる）。

**MINOR で済むのは、この 2 ファイルをバレルから re-export していないからである。**
`index.ts` が `export * from './domain/frame-contract'` を持っていた時期があり、その形のままだと
`StageId` / `DeltaTimeSecs` / `StageRegistration` が「所有していないパッケージの公開 API」になり、
約束済みの削除が**すべての消費者にとっての MAJOR**に化けていた。
今は `index.ts` の末尾コメントが 2 ファイルの存在と削除予定だけを記し、名前は 1 つも出していない
（`test/public-api.test.ts` の
`REGRESSION: does not republish mc-kernel’s vocabulary as its own` が固定している）。
mc-sim / mc-render / mc-playground-kit のバレル、および mx-redstone / mx-ui も同じ形である。

**ただし、この瞬間から `mc-kernel` へのバージョンピンが意味を持ち始める。**
今日この repo は kernel の変更に一切影響されない（依存していないので当然である）。
削除の後は、kernel の major bump がこの repo の major bump を要求する。
再掲を消すのは「独立を捨てて正しさを買う」取引であり、kernel が publish されるまでは
そもそも取引が成立しない。

## 6. このリポジトリにとっての破壊的変更

> **`0.x` の間の読み替え（全 16 リポジトリ共通の方針）**
>
> 本リポジトリは `0.1.0` であり、下流が契約を実際に消費して確認するまで `0.x` から出ない。
> **semver では `0.x` の破壊的変更は major bump ではなく minor bump である**（`0.1.0` → `0.2.0`）。
> したがって以下の MAJOR / MINOR / PATCH は **`1.0.0` 到達後の分類**であり、
> `0.x` の間は次のように読み替える。
>
> | 分類 | `1.0.0` 到達後 | `0.x` の間（現在） |
> | --- | --- | --- |
> | MAJOR | major bump | **minor bump**（`0.1.0` → `0.2.0`） |
> | MINOR | minor bump | patch bump |
> | PATCH | patch bump | patch bump |
>
> 分類そのものは `0.x` でも意味を持つ。MAJOR に分類される変更は、
> bump の大きさに関わらず**下流に必ず影響するもの**であり、告知と協調リリースの対象である。
> `0.x` の間に major bump を切ることはない。

**公開しているのが stage 登録だけなので、破壊的になりうる変更は極めて少ない。**
これは `mc-kernel` や `mc-sim` と決定的に違う点である（あちらは 14 / 全下流に波及する）。

| 変更 | 分類（`1.0.0` 到達後の bump。`0.x` では上記の読み替え） | なぜ |
| --- | --- | --- |
| **ルールを 1 本足す**（新しい `interaction-*`、新しい Mob） | **PATCH / MINOR** | 界面に何も現れない。`gameplay:interactions` の中で起きる |
| ルールの挙動を変える（ドロップ数、ダメージ量） | MINOR | ゲームの挙動は変わるが、契約は変わらない |
| 内部(可視) の export の追加 | MINOR | [public-api.md](./public-api.md) §5 |
| 内部(可視) の export の削除 / 改名 | MINOR | 契約ではない。ただし自分のプレビューとテストは直す |
| `domain/frame-contract.ts` / `position-key.ts` の削除（kernel 移行） | MINOR | §5-1 |
| **新しい `StageId` を登録する** | **MAJOR** | `mc-compose` の順序表に新しい頂点が現れる。compose は必ず対応を要求される |
| **`after` の集合を変える** | **MAJOR** | 全順序の解が変わる。他モジュールの位置が動きうる |
| **stage の粒度を変える**（4 本を 3 本に統合、5 本に分割） | **MAJOR** | 上の 2 つの複合。compose 側の順序表を書き直させる |
| `GameModule` の `layers` を追加する | MAJOR | compose が Layer をマージする必要が生じる |
| ドキュメント・コメントのみ | PATCH | |

**「ルールを足すのは破壊的変更ではない」がこのリポジトリの設計上の狙いである。**
200 commits / 3 ヶ月（plan.md §3.11）の変更頻度で、その大半が
`gameplay:interactions` の中の 1 ファイルの追加であるなら、
下流の bump 連鎖は発生しない。これは偶然ではなく、
**多数のファイルと 1 つの stage 登録**（DN-GP-9）を選んだ結果である。
40 個の `StageRegistration` を公開していたら、ルールを 1 本足すたびに MAJOR になっていた。

逆に言えば、**MAJOR に該当するのは全部「フレーム契約に現れる形」の変更だけ**である。
`test/stage-registration.test.ts` の
`the declared constraints form the §4.2 skeleton fragment gameplay is responsible for` が
stage id の集合と `after` の集合を丸ごと assert しているので、
これらの MAJOR 変更はテストの diff として必ず現れる。
**bump の判断は git diff ではなくこのテストの diff を見て行う。**

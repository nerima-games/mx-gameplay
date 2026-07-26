# mx-gameplay ドキュメント

`@nerima-games/mx-gameplay` は 16 リポジトリ構成の**体験モジュール**であり、遊びのルールを持つ。
plan.md §3.11 の予測どおりなら**最も変更頻度が高いリポジトリ**になり、それでいて**分割は禁止**されている。

変更が速く、分割で逃げられないリポジトリで境界を保つには、境界を文章ではなくゲートで持つしかない。
本ドキュメント群は、そのゲートが何を守っていて、なぜその形なのかを記録したものである。

上位仕様は `/Users/take/Documents/plan.md`（以下 plan.md）。
参照実装は `/Users/take/ghq/github.com/takeokunn/ts-minecraft`（以下、`packages/…` のパスはこのリポジトリルート相対）。

## 索引

| ドキュメント | 内容 | 主な読者 |
| --- | --- | --- |
| [architecture.md](./architecture.md) | 4 階層、全 16 リポジトリの依存グラフ、**名詞/動詞ルール**、体験モジュール間エッジがゼロである理由と 2 段のゲート | このリポジトリに import を足したくなった人 |
| [responsibility.md](./responsibility.md) | 責務と、**明示的な非スコープ**（それぞれの行き先つき）、分割しない理由 | 「これはここに書くべきか」で迷った人 |
| [public-api.md](./public-api.md) | 契約は stage 登録だけ。`StageRegistration` の逐語再掲、`index.ts` の全 export の 契約 / 内部(可視) 分類 | mc-compose の実装者、および export を足す人 |
| [design-notes.md](./design-notes.md) | **DN-GP-1〜10。** 参照実装で実測された失敗と、それを固定している回帰テストの名前 | ルールを実装する人（全員） |
| [porting.md](./porting.md) | 移植元の**実測 LOC**、plan.md 見積との差分、境界の移動、移植順序 | 移植作業に着手する人 |
| [testing.md](./testing.md) | 検証要件、プレビュー 3 本、99% カバレッジゲートの投入時期、決定論の作り方 | CI / テストを触る人 |
| [versioning.md](./versioning.md) | 0.x → 1.0.0 方針、GitHub Packages、**このリポジトリにとって破壊的変更とは何か** | リリース作業者 |

## どこから読むか

- **初めてこのリポジトリを触る**: [architecture.md](./architecture.md) §3（名詞/動詞）→ [responsibility.md](./responsibility.md) §3（非スコープ）。
  この 2 節を読まずにコードを足すと、ほぼ確実に「本当は `mc-sim` に置くべき状態」をここに置くことになる。
- **ルールを 1 本実装する**: [design-notes.md](./design-notes.md) を通しで読む → [porting.md](./porting.md) で移植元と順序を確認 →
  [testing.md](./testing.md) §2 でオラクル（参照実装のテスト）を先に移植する。
- **mc-compose 側からこのリポジトリを使う**: [public-api.md](./public-api.md) だけでよい。他は内部事情である。
- **export を足したくなった**: [public-api.md](./public-api.md) §5 の分類表。「契約」に入れるのは
  それが本当に他リポジトリの依存先になるときだけで、現在その資格があるのは stage 登録だけである。
- **依存を足したくなった**: [architecture.md](./architecture.md) §4。おそらく足すべきではない。

## ドキュメントの位置づけ

`design-notes.md` だけは性質が違う。あれは**設計方針ではなく事故報告**である。
10 項目のうち想像で書かれたものは 1 つもなく、すべて参照実装の production で実際に起きたことか、
plan.md が実測知見として確定させたものである。

各項目は **規則 / 根拠 / 回帰テスト** の 3 つを持つ。
根拠は参照実装の `path:line`（DN-GP-1〜3）か plan.md の節番号（DN-GP-4〜10）。
回帰テストは**実在する describe / it のタイトル**で示してある。
現在 3 つ目を欠いているのは DN-GP-10（`Ref.modify` / TOCTOU）だけで、その理由も当該節に書いてある。

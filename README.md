# STACK PRT 比較アンケート

STACK問題の誤答診断つきPRT（複数の作成方法）を、評価者が匿名ラベル **PRT-A / B / C / …** で比較評価する静的サイトです（Vite + Vue、GitHub Pagesにデプロイ）。CASの実行・Moodleへのログインは不要です。

## 全体の流れ

```
json/survey_dataset_*.json   （実トラック名入り・非公開・gitignore）
        │  npm run prepare-survey
        ├─► public/survey.json          匿名化済み（PRT-A/B/C のみ）→ 公開
        ├─► public/assignments.json     評価者 → 担当問題
        └─► private/track_mapping_<mapping_id>.json   対応表（非公開・gitignore）
                                                       ↑
評価者ブラウザ ──回答(PRT-A/B/C + mapping_id)──► Apps Script → スプレッドシート
                                    └──► JSONエクスポート（予備）
                                                       │
                        npm run decode ◄───────────────┘  → out/nodes.csv, out/prts.csv（実トラック名付き）
```

## セットアップ

Node.js 20.19 以上（`.nvmrc` は 22。`nvm use` で切り替え）が必要です。

```bash
npm install
# 1) 匿名化データと割り当てを生成（評価者6名・各問題を2名で重複評価・8問ずつのブロック）
npm run prepare-survey -- --raters 6 --overlap 2 --block 8
# 2) ローカル確認
npm run dev
```

**全員が同じ16問を評価する場合**（人間版を含む4トラック）:

```bash
npm run prepare-survey -- --input json/survey_16.json --require human \
  --raters r01-ca8870,r02-c5cb26,r03-c0bfb8,r04-88edcc,r05-78f691,r06-3daf54 \
  --overlap 6 --block 16
```

`--overlap` を評価者数と同じにし、`--block` を問題数以上にすると、全員が全問を担当します。

- `--input` 省略時は `json/` 内の最新の `survey_dataset*.json` を使います。
- `--raters 6` はランダムな評価者コード（例 `r01-3fa2c1`）を生成し、配布用URL `<サイトURL>/?e=<コード>` を表示します。名前で指定するなら `--raters R01,R02,...`。
- `--raters` を省略すると割り当てなし（任意のコードで全問を担当）になります。
- コード修正後に**同じ対応表のまま**作り直したいときは `--reuse-mapping <mapping_id>` を付けます（`private/` の対応表を使い、入力JSONが同一でなければエラー）。
- **付けずに実行するたびに対応表が新しく作り直されます**（`--help` 以外の実行はすべて前処理が走ります）。公開後に再実行すると mapping_id が変わり、それまでの回答は旧 mapping_id の対応表で復号されます（両方の `private/track_mapping_*.json` を残しておけば問題なし）。

> ⚠️ `private/track_mapping_*.json` がないと回答を実トラック名に戻せません。必ずバックアップを取ってください（リポジトリにはコミットされません）。

## トラック（作成方法）の追加 — 例: 人間が作ったPRT

トラックはデータから自動検出されるので、コードの変更は不要です。`survey_dataset*.json` の各問題の `tracks` に、
既存と同じ形式で新しいキー（例: `human`）を足して `npm run prepare-survey` を実行するだけです。

```json
"tracks": {
  "traditional": { ... }, "norag": { ... }, "kc": { ... },
  "human": { "question_id": 0, "name": "...", "questiontext": "<p>...</p>", "preview_url": "",
             "prt": { "firstnodename": "1", "nodes": [ ...nodes[0]=正答判定, nodes[1..]=誤答診断... ] } }
}
```

- 問題ごとに、PRTがあるトラックの数だけラベルを振ります（3つなら PRT-A〜C、4つなら PRT-A〜D）。人間版がない問題は3つのまま表示されます。
- PRTが2つ未満の問題は除外します。
- `--require human` を付けると、人間版がある問題だけを対象にします。問題によって PRT の個数が違うと「4つ並んでいる問題には人間版が入っている」と推測できてしまうため、D3 を厳密に測りたい場合はこちらを推奨します。
- `--tracks traditional,norag,human` のように、使うトラックを限定することもできます。
- 人間版は scoremode（`=` / `+`）・変数名（`wa1` 等）・description の書き方を既存トラックに揃えて作ると、書き方の癖から作成者を推測されにくくなります。

## 問題文

評価者に見せる問題文は、各問題（item）の `stack_question_text`（3トラック共通）です。無い場合のみ `source_question_text` で代用し、前処理時に警告を出します。
`tracks.*.questiontext`（トラックごとの問題文）は、書き方の違いから作成方法を推測できてしまうため、公開データには含めません。

## 問題変数（ta / wa1 / wa1_pred …）の表示

各トラックに次のフィールドがあれば、ノードごとに「この判定で使われている式」として定義を表示します（無くても動作します）。

| フィールド | 内容 | Moodle DB（STACK）の取得元 |
|---|---|---|
| `tracks.<t>.questionvariables` | 問題変数（Maxima コード文字列） | `mdl_qtype_stack_options.questionvariables` |
| `tracks.<t>.inputs` | 解答欄 `[{ "name": "ans1", "type": "algebraic", "tans": "ta" }]` | `mdl_qtype_stack_inputs`（`name`, `type`, `tans`） |
| `tracks.<t>.prt.feedbackvariables` | PRT内の変数（Maxima コード文字列） | `mdl_qtype_stack_prts.feedbackvariables` |

```sql
SELECT questionvariables FROM mdl_qtype_stack_options WHERE questionid = :qid;
SELECT name, type, tans  FROM mdl_qtype_stack_inputs  WHERE questionid = :qid ORDER BY name;
SELECT feedbackvariables FROM mdl_qtype_stack_prts    WHERE questionid = :qid AND name = 'prt1';
```

`:qid` は各トラックの `question_id` です。CAS は実行せず、`名前: 式;` / `関数(x) := 式;` を解析して、SAns・TAns に出てくる名前の定義を（依存先も含めて）表示します。

### Maxima → LaTeX 変換

定義の式は [src/lib/maxima2tex.js](src/lib/maxima2tex.js) で LaTeX に変換し、KaTeX で数式として表示します（約300行・依存なし）。

- 対応: 四則・`^`・`sqrt`・`abs`・`exp`・`log`・三角/逆三角/双曲線関数・`diff`・`integrate`/`int`・`limit`・`subst`（`subst([C=0,c=0], e)` の同時置換を含む）・`freeof`・`is`・`equal`・`and/or/not`・関係演算子（`#` は ≠）・リスト・`%pi` `inf` など。
- STACK 特有の関数は日本語の演算名で表示します: `ratsimp`/`radcan`/`trigsimp` → 整理、`expand` → 展開、`factor` → 因数分解、`num` → 分子、`denom` → 分母、`hipow(e,x)` → deg_x(e)、`ratcoef(e,x,n)` → 係数_{xⁿ}(e)。
- 上記以外の関数は `\operatorname{名前}(…)` で表示します。
- 問題変数・feedbackvariables は、`;` / `$` に加えて**改行も文の区切り**として解析します（STACK と同じ。人間が書いた PRT は `;` を付けないことが多いため）。
- 述語関数（`wa1_pred(ex) := is(...)`）は `⇔` で表示します。
- 構文解析できない式（`if` / `block` / `for` など）は、原文を等幅で表示します。「Maxima 原文」を開けば、変換前の式をいつでも確認できます。
- 既存ライブラリは調べましたが、Maxima 構文を LaTeX に直す JS ライブラリは見つかりませんでした（STACK MP LITE は構文解析のみで LaTeX 出力なし、TeX2Max は逆方向、Maxima 本体の `tex()` は CAS が必要）。



## フィードバックの位置（true側 / false側）

トラックによって、診断フィードバックを置く分岐が違います（traditional / norag / 人間版は true 側、chain 型の KC 版は false 側）。
設問 C2〜C4 は「そのノードにあるフィードバック」を対象にし、画面には `（true側）` / `（false側）` と表示します。
両方の分岐に無い場合のみ「フィードバックなし」になります。

また、判定式が条件式（`is(...)` など）で TAns が `true` / `false` のノードは、「条件が成り立つか / 成り立たないか」という文で説明します。

## 匿名化の設計

- トラック名→ラベルの対応は **ビルド前の前処理で生成** します。ブラウザでロード時に生成すると、実トラック名をクライアントに送る必要があり DevTools から見えてしまうためです。
- 公開ファイルから `question_id`（トラックごとに番号帯が違う）と `preview_url` も削除しています。
- 対応は問題ごとに crypto 乱数で決めます。トラックの組み合わせごとに全順列（3つなら6通り、4つなら24通り）を均等回数ずつ割り当てるので、各トラックが各ラベル位置にほぼ同数ずつ現れます。
- 回答には `mapping_id` と `PRT-A/B/C` のみが記録され、復号は研究者のローカルでのみ行います。
- **書き方の癖による推測**: 作成方法は名前を隠しても、データの癖で見分けられることがあります。公開前に次を確認してください。
  - scoremode（`=` / `+` / `-`）の使い方、`description` の有無、true/false どちらにフィードバックがあるか
  - 使っているアンサーテスト（`Int` 等）、`feedbackvariables` の有無
  - 人間版だけに偏る特徴があれば、D3（人間か AI かの推測）の結果は「癖で当てられた分」を含みます。可能なら作成側で揃え、揃えられない分は論文の限界として記載してください。
  - HTML の属性（`<p dir="ltr" style="…">` など）は DOMPurify が除去するため、画面には出ません。
- GitHub Actions は、`public/survey.json` の PRT のキーが `PRT-A`, `PRT-B`, … だけであること、実トラック名が含まれていないことを毎回チェックします。

## 回答の保存先（推奨構成）

1. **Google Apps Script + スプレッドシート**（メイン）
   - `apps-script/Code.gs` の手順に従ってWebアプリとしてデプロイ。
   - GitHub リポジトリの *Settings → Secrets and variables → Actions → Variables* に
     `VITE_SUBMIT_ENDPOINT`（WebアプリURL）と `VITE_SUBMIT_TOKEN` を登録。
   - 「送信して次の問題へ」で1問ごとに送信。失敗時は「未送信を再送」から再送できます。
2. **ブラウザの localStorage**（自動保存）：入力のたびに保存。同じURLを開けば再開できます。
3. **JSONエクスポート**（予備）：「回答をJSONで保存」でファイルを提出してもらえます。エンドポイント未設定ならこれが唯一の提出方法です。

`VITE_SUBMIT_TOKEN` はビルド成果物に含まれるため秘密ではなく、無関係なbotからの書き込みを防ぐ程度のものです。

## 評価者の認証・割り当て

- 認証はパスワードなしの **推測困難な評価者コード入りURL** 方式です（`?e=r01-3fa2c1`）。評価者ごとにURLを個別に送付してください。
- 割り当ては問題を連続ブロック（同じ問題セットの小問がまとまる）に分け、各ブロックを `--overlap` 人にラウンドロビンで割り当てます。重複評価で評価者間一致度（κ・ICC等）を算出できます。
- 目安：1問あたり誤答診断ノードが約10個（3 PRT合計。4 PRTなら約13個）× 設問4つ＋PRT全体の設問。1人あたりの担当数は負担に応じて `--raters` / `--block` で調整してください。

## 集計

```bash
# スプレッドシートを CSV でダウンロード、またはエクスポートJSONを集めて
npm run decode -- responses/sheet.csv responses/*.json --out out/
```

- `out/nodes.csv`：誤答診断ノード単位（C1〜C4、元のスコア、実トラック名）
- `out/prts.csv`：PRT単位（D1〜D4、実トラック名）
- 同じ（評価者, 問題）の回答が複数ある場合は `updated_at` が最新のものを採用します。
- `out/` には実トラック名が入るため gitignore 済みです。

## デプロイ（GitHub Pages）

1. リポジトリを作成し、`public/survey.json`・`public/assignments.json` を含めて push（`json/`, `private/` は gitignore 済み）。
2. *Settings → Pages → Source* を **GitHub Actions** に設定。
3. `main` へ push すると `.github/workflows/deploy.yml` がビルド・デプロイします。

`vite.config.js` は `base: './'` なので `https://<user>.github.io/<repo>/` のサブパスでも動きます。

> 公開リポジトリ・公開Pagesでは `survey.json`（PRTの中身）は誰でも閲覧できます。問題やPRTを非公開にしたい場合は private リポジトリ＋Pagesのアクセス制限（GitHub Enterprise）等を検討してください。

## セキュリティ

- `feedback` / `questiontext` のHTMLは DOMPurify で許可タグ（`p`, `strong`, `br` 等）のみ残してから描画し、数式は KaTeX（`trust: false`）でテキストノードからレンダリングします。属性は `class` 以外すべて除去されます。
- 評価者の自由記述は Vue のテキスト補間でのみ表示されます（HTMLとして解釈されません）。

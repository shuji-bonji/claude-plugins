# 利用上の注意（詳細）

[English](./NOTES.md) | [README に戻る](../README.ja.md)

[README](../README.ja.md) の「利用上の注意」に挙げた項目について、変更の経緯と中身を残した文書です。README は「何をすればよいか」だけを載せ、この文書は「何がどう変わったのか」を載せます。

## 全 MCP 共通

### Node.js の要件

MCP server は `npx` で起動するため、手元の Node.js の版で起動できるかが決まります。`pdf-reader-mcp` / `pdf-verify-mcp` / `pdf-writer-mcp` / `pdf-spec-mcp` は **Node 20 以上**、`houki-egov-mcp`（v0.4.0 以降、2026-09-07）/ `houki-nta-mcp`（v0.10.0 以降、2026-09-07）/ `rfcxml-mcp` / `w3c-mcp` / `web-compat-mcp` / `xcomet-mcp` / `epsg-mcp` / `rxjs-mcp` は **Node 22 以上**、`ifc-core-mcp` は **Node 22.12 以上**です（各 repo の `package.json` の `engines.node`）。Node 20 は 2026-04-30 に EOL を迎えており、Node 22 を要件とする 9 本は Node 20 では起動しません。

### MCP SDK v2 への移行

2026-08-27 の PDF family 4 本を皮切りに、2026-09-07 までに 13 本すべての MCP server が `@modelcontextprotocol/sdk`（v1）から `@modelcontextprotocol/server@^2.0.0` に移りました（`houki-egov-mcp` は v0.4.0、`houki-nta-mcp` は v0.10.0、いずれも 2026-09-07。後者で [claude-plugins#4](https://github.com/shuji-bonji/claude-plugins/issues/4) は完了です）。SDK の `registerTool` を使う 11 本に共通して届く変更は 2 つです。(1) **`tools/list` の `inputSchema` の `$schema` が JSON Schema 2020-12 になります**（それまでは draft-07）。(2) **型の合わない引数は SDK が handler を呼ぶ前に拒否し、`isError: true` のツール結果（`Input validation error: ...`）で返します** —— それまでは server ごとに自前の検証で、返る JSON の形も違いました。宣言に無い引数を拒否するか黙って捨てるかは server ごとに違います（PDF family 4 本は拒否します。下の段落を参照）。`houki-egov-mcp`（v0.5.3 以降）と `houki-nta-mcp`（v0.10.0 以降）はこの 2 点の例外です。エラー JSON を houki-hub family の contract に揃えるため SDK の低レベル `Server` を使い続けているので、`inputSchema` に `$schema` は付かず（以前と同じ素の JSON Schema）、型・必須・enum に合わない引数を handler の前で `{ "code": "INVALID_ARGUMENT", "detail": { "issues": [...] } }` + `isError: true` で返します（`Input validation error: ...` の形ではありません）。宣言に無い引数はそのまま通します。`houki-nta-mcp` は v0.10.0 で、v0.9.5 までと違う点が 2 つあります。知らないツール名は `{ "code": "UNKNOWN_TOOL" }` + `isError: true` で返ります（それまでは `{ "error": "Unknown tool: ..." }`）。また、family のエラー JSON（`TSUTATSU_NOT_FOUND` / `ARTICLE_NOT_FOUND` など）を返すツール結果に `isError: true` が付きます（それまでは通常の結果として返っていました）。ツール名と引数を宣言どおりに渡している限り、`npx` で使う側に作業はありません。移行と同時に Node 要件を上げた server があるので、上の Node.js の要件を確認してください。w3c-mcp は v0.2.0 で、0.1.9 から非推奨だった `get_spec_dependencies` を削除しました（上流の web-specs に依存データが無く、常に空配列を返していました。`get_w3c_spec` を使ってください）。

### PDF family の 4 MCP（2026-08-27 の版）

`pdf-spec-mcp` v0.6.0 / `pdf-reader-mcp` v0.13.0 / `pdf-verify-mcp` v0.18.0 / `pdf-writer-mcp` v0.21.0 では、ツールは 1 つも増減せず出力も変わりませんが、**呼び方に届く変更が 3 つ**あります。(1) **宣言に無い引数を拒否します** —— それまでは黙って捨てられ、呼び出しは成功していました。(2) **知らないツール名は JSON-RPC エラーで返ります** —— それまではツール結果の `isError: true` でした。`isError` だけを見るクライアントには届かず、`await client.callTool(...)` は解決せずに例外を投げます。(3) `inputSchema` の `$schema` が JSON Schema 2020-12 になり、`pdf-writer-mcp` の `add_bookmarks` は `$ref` の指す先が `#/definitions/` から `#/$defs/` に移ります。加えて **`pdf-reader-mcp` は Node 20 以上が必要**になりました（v0.12.0 までは 18 でも動きました）。Skill 経由の利用（pdf-trust / pdf-publish / pdf-read）は、渡す引数がいずれも宣言済みであることを確認済みで、影響を受けません。

## pdf-reader-mcp

### v0.14.0 — テキストを返すツールの出力の形

**`pdf-reader-mcp` v0.14.0 で、テキストを返すツールの出力の形が変わりました。** ページから文字を取り出すことと、その文字が Unicode に変換できるかを観測すること（ISO 32000-2 §9.10.1）は別々の読みで、別々に失敗します。そのため各ツールは **`scope`**（どちらの読みが行われたか）を載せるようになり、**行われなかった読みの項目は `null`（`0` でも `false` でも空文字でもない）**になりました。`read_text` と `read_url` は、ページの配列そのものではなく `{ scope, pages }` を返します。あわせて不具合を 2 つ直しています。`read_url` は**全入力でエラーを返していました**（取得したバイト列を 2 人の読み手に渡していて、先の 1 人が中身を持っていっていた）。`render_page` は、タイリングパターンが天文学的な枚数のタイルを要求するページでサーバごと止まることがありました（いまは別スレッドで 1 ページ 20 秒の予算を置きます）。Skill 経由なら対応済みです —— `pdf-read` **v0.2.0+** と `pdf-publish` **v0.7.0+** が `scope` を読みます。古い Skill を 0.14.0 のサーバに当てると、パスワード付き文書での停止が働きません。

### v0.15.0 — `inspect_structure` の出力

**`pdf-reader-mcp` v0.15.0 で `inspect_structure` の出力が変わりました。** pdf-lib を外し、読み取りは [`@normativepdf/recover`](https://www.npmjs.com/package/@normativepdf/recover) を通ります。`objectStats.byType` と `catalog[].type` は、それまで pdf-lib のクラス名（`PDFCatalog` / `PDFPageTree` / `PDFRawStream` / `PDFNumber` など）を返していましたが、ISO 32000-2 §7.3 の COS 型名（`dict` / `stream` / `array` / `name` / `string` / `integer` / `real` / `boolean` / `null` / `ref`）を返します。辞書の `/Type`（`Catalog` / `Pages` / `Page` / `Font` など）は別のフィールド `objectStats.byDocType` に分かれ、相互参照表に無いオブジェクトは数えなくなり、表にはあるが読めなかったオブジェクトは `objectStats.unreadable` に出ます。空のユーザーパスワードで鍵が導ける暗号化文書は読めるようになり、鍵が導けない文書では `inspect_signatures` が「署名フィールド 0 件」ではなく読めなかった理由を返します。`objectStats.byType` の値を読んでいる呼び出し側は直してください。

## pdf-verify-mcp（pdf-trust の前提）

### v0.14.0 以前 — DocTimeStamp が一律 INDETERMINATE

前提の `pdf-verify-mcp` **v0.14.0 以前**には、DocTimeStamp（ETSI.RFC3161）の検証が**一律 INDETERMINATE になる欠陥**があります（**v0.14.2 で修正済み**。pyHanko / esig-dss / 官報の 3 系統の検体で確認）。長期保存（B-LTA・電帳法）の受入監査は v0.14.2 以上で行ってください。

### v0.14.2 以前 — リビジョン履歴が完全と報告される

前提の `pdf-verify-mcp` **v0.14.2 以前**には、**追えない `/Prev` を「前のセクションは無い」と読み、リビジョンチェーンを完全なものとして報告する欠陥**があります（8 リビジョン 5 署名の検体が「1 リビジョン」と報告されました。**v0.15.0 で修正済み**）。**全履歴を約束する監査** — `legal` / `medical` プロファイル、および「署名後に本文が書き換えられたか」が争点の契約書 — は **v0.15.0 以上**で行ってください。旧版では、短くなった一覧を「一度も変更されていない文書」と見分けられません。

### v0.15.1〜v0.16.0 — 報告書に書ける内容

`pdf-verify-mcp` の変更 3 件は、判定ではなく**書ける内容**に効きます。**v0.15.1** から、適合の判定を出した veraPDF の版が記録されます（`authoritativeValidation.version`）。規則の数（「146 / 146」など）は**同じビルドの実行どうしでしか比べられない**ので、それ以前の報告書は自分の数字を誰が出したのか言えません。**v0.15.2** では `verify_integrity` の説明を直しました —— 返ってきた `revisions` は**全履歴とは限りません**。**v0.16.0** でそれがフィールドになりました（`revisionChain: { status, missing }`）—— それまで信号は `notes` の英文だけで、Skill は「全履歴を約束してよいか」を**散文の照合**で決めていました。「一覧に出てこない = 行われていない」と書けるのは `status: 'complete'` のときだけです。チェーンが切れると残った 1 件が「元版」扱いになり、**機械が読めるフィールドは全部「何も足されていない」と言います**。**pdf-trust v0.6.0 以上がこのフィールドを読みます**（0.15.x 向けの散文による退避も残してあります）。3 件とも旧版の判定が誤っていたという話ではなく、**報告書に何を書けるか**が変わります。

### v0.20.0〜v0.21.0 — 出力の形

`pdf-verify-mcp` **v0.21.0** で `verify_signatures` と `detect_pades_level` の JSON は、最上位が配列から辞書になりました（`[ {...} ]` → `{ scope, signatures: [ {...} ] }` / `{ scope, levels: [ {...} ] }`。一覧の中身は 1 鍵も変わっていません）。配列を直接読んでいる呼び出し側は `.signatures` / `.levels` を挟んでください。形を変えた理由は `scope` です —— 相互参照表を組み直した文書（`scope.reconstructed: true`）では組み直しに入らなかった署名が一覧に出ないので、一覧と同じ場所で読んだ範囲を見られる必要があります。v0.20.0 では、条文を名指しして読めなかった場合の `code` が `INTERNAL_ERROR` から `PARSE_FAILED` に分かれました。**pdf-trust v0.8.0** は判定の前に `scope` を読む手順（Phase 1.5）を持ち、`PARSE_FAILED` を「未実施項目」に入れません。pdf-trust の README は **pdf-verify-mcp v0.21.0 以上**を推奨しています。

## pdf-writer-mcp（pdf-publish の前提）

前提の `pdf-writer-mcp` も marketplace に収録済みです（版は上の一覧表を参照）。PDF/A-3b の器付け（`ensure_pdfa`）が入ったのは **v0.15.0**、**PDF/A-4 / PDF/A-4f と PDF 2.0 出力は v0.16.0** です（CSV や JSON を添付した文書は `pdfa-4` ではなく `pdfa-4f` を名乗る必要があります）。**v0.17.0** からは `ensure_pdfa` が `declarationRisks` を返し、**測ると落ちると分かっている宣言**（現状はフォント未埋め込み）を散文の警告に埋めずに名指しします。なお v0.14.0 以前には、Markdown 生成時に `snake_case` の `_` が無警告で消える欠陥があります（[B-17](https://github.com/shuji-bonji/pdf-writer-mcp/blob/main/docs/TASKS.md)・**v0.14.1 で修正済み**）。古い版を掴んでいる場合は、関数名を含む技術文書で出力を確認してください。また v0.18.0 以前には、`%PDF-` が 0 バイト目から始まらない入力に `preserveSignatures: true` を掛けると壊れたファイルを書く欠陥があります（ISO 32000-2 §7.5.2 が認める合法な形で、前置バイトを足す道具の出力がこれに当たります。[B-22](https://github.com/shuji-bonji/pdf-writer-mcp/blob/main/docs/TASKS.md)・**v0.19.0 で修正済み**）。

## pdf-spec-mcp

ISO 32000 仕様 PDF は利用者が用意し、環境変数 `PDF_SPEC_DIR` で配置先を指定してください。**v0.5.0** から、検索索引と要件の全走査は初回構築のあとディスクにキャッシュされます（`${XDG_CACHE_HOME:-~/.cache}/pdf-spec-mcp`、コーパス全体で約 18 MB。`PDF_SPEC_CACHE_DIR` で置き場所を変更、`PDF_SPEC_CACHE=off` で無効）。セッションごとに起動するサーバプロセスでも、`search_spec` は 6〜14 秒の再構築ではなく 1 秒未満で返ります。`npx -y @shuji-bonji/pdf-spec-mcp@latest --build-cache` で全仕様を事前構築できます。キャッシュは利用者の PDF から利用者の機械上に作る派生物で、配布はしません。

## xcomet-mcp

xCOMET を導入したローカル Python 環境が必要です。環境変数 `XCOMET_PYTHON_PATH` は **v0.6.3 から任意**になりました（venv や既定以外のインタプリタを使う場合のみ指定、未設定なら自動検出）。詳細は [repo の README](https://github.com/shuji-bonji/xcomet-mcp-server) を参照。

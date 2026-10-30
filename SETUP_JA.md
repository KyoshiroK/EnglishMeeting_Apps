# 公開と利用の手順（Windows PC）

## 1. GitHubへフォルダをアップロード

1. ZIPを右クリックし「すべて展開」。`meeting-assist` フォルダを開きます。
2. 新しいGitHubリポジトリを開き「Add file → Upload files」を選択。
3. `meeting-assist` の**中身**をすべてドラッグしてアップロードし「Commit changes」。リポジトリ直下に `docs` と `worker` が並ぶ状態にします。外側の `meeting-assist` フォルダを一段余計に入れないでください。
4. 「Settings → Pages」で Source を「Deploy from a branch」、Branch を「main」、フォルダを「/docs」にして保存します。
5. 公開完了後、表示されるURL（通常 `https://ユーザー名.github.io/リポジトリ名/`）を開きます。まず「デモを見る」でUIを確認できます。リポジトリの設定や契約によってPagesの公開条件が異なる場合があります。

画面はGitHub Pagesにそのまま置けます。API中継はPages上では動かないため、次の設定も行ってください。

## 2. API中継をCloudflare Workersに配置

### 方法A：Cloudflareの画面でコピー＆貼り付け（Node.js不要）

1. Cloudflareのアカウントにログイン。Workers & PagesからWorkerを新規作成します。画面の表記が変わっている場合は「Hello World」等の最小のWorkerを選択します。
2. Worker名を `meeting-bridge` にして作成・配備します。
3. コード編集画面で、`worker/src/index.js` をVS Codeやメモ帳で開き、**内容全体**をコピー。Workerのコード全体を置き換えて配備します。`export default` をそのまま使うモジュール形式です。
4. Workerの「Settings → Variables and Secrets」で下表を追加します。Secretは値を暗号化する種類を選択してください。

| 名前 | 種類 | 設定する値 |
| --- | --- | --- |
| `OPENAI_API_KEY` | Secret | ご自身のOpenAI APIキー |
| `APP_TOKEN` | Secret | ご自身で生成した32文字以上のランダムな利用トークン |
| `ALLOWED_ORIGINS` | Text | `https://ユーザー名.github.io`（リポジトリ名や末尾スラッシュを付けない） |
| `TRANSCRIBE_MODEL` | Text | `gpt-live-transcribe` |
| `TEXT_MODEL` | Text | `gpt-5.4-mini` |
| `REASONING_EFFORT` | Text | `none` |

5. 保存した設定を配備し、Worker URL（例：`https://meeting-bridge.あなたのサブドメイン.workers.dev`）を控えます。
6. 方法Aでは `wrangler.toml` のレート制限設定は自動適用されません。コードはバインディングがなくても動作します。必要に応じWorker設定でRate limitingバインディングを追加するか、方法Bを使ってください。個人用トークンを第三者に共有しないでください。

利用トークンはWindows PowerShellで次のコマンドを実行すると生成できます。表示された値を自分用に控え、Workerの `APP_TOKEN` と、後述するアプリ画面の「アプリ利用トークン」に同じ値を入力します。

```powershell
$meetingTokenBytes = New-Object byte[] 32
$meetingRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$meetingRng.GetBytes($meetingTokenBytes)
[Convert]::ToBase64String($meetingTokenBytes)
$meetingRng.Dispose()
```

**OpenAI APIキーはGitHubにもアプリ画面にも貼り付けません。WorkerのSecretだけに設定します。** `APP_TOKEN` もリポジトリに書き込まないでください。

### 方法B：PCからコマンドで配備（レート制限込み）

Node.js 22以降をインストールし、PowerShellで `worker` フォルダを開きます。`wrangler.toml` の `YOUR_GITHUB_USER` を実際のGitHubユーザー名に変更します。ALLOWED_ORIGINSにはURLのオリジンだけを指定します。

```powershell
cd "C:\展開した場所\meeting-assist\worker"
npm install
npx wrangler login
npm run deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_TOKEN
```

`secret put` の入力待ちになったら、それぞれの値を貼り付けてEnter。初回の配備後、Secretが揃うまではAPIは503を返します。作成済みのWorkerを更新する場合はWorker名・Cloudflareアカウントを確認してください。名前が他用途と衝突する場合は `name` を変更できます。

`namespace_id` 1001 / 1002を同じCloudflareアカウント内の別Workerで使っている場合は、未使用の正の整数文字列へ変更してください。HTTPは180回/分、セッション作成は6回/分の目安で制限します。Cloudflareのレート制限は地域ごとの概算で、厳密な課金上限ではありません。

## 3. アプリに接続先を入力

1. GitHub PagesのURLをChrome / Edgeで開きます。
2. 「接続・会議設定」で「中継API URL」にWorker URLを入力（末尾の `/live` などは不要）。
3. 「アプリ利用トークン」に先ほど作成した `APP_TOKEN` を入力。
4. 会議の背景・用語を入力。英語表記の製品名や略語があると認識の手掛かりになります。例：`Cloud lab automation meeting. Terms: AMR, workcell, microplate, throughput.`
5. あなたの立場・確認済みの情報を入力。例：`開発担当。納期は未確定。予算は回答できない。まず仕様を確認したい。`
6. 「設定を保存」。保存するのはURLと認識モードだけです。トークンと会議情報は再読み込み時に入力し直します。
7. まず手入力欄へ `Could you give us an update on the project timeline?` と入れて「翻訳・質問判定」を押すとAPI接続を確認できます。

## 4. 会議音声を取り込む

### ブラウザー版Teams / Zoom / Meet等

1. 会議を別タブで開き、相手の音声がPCから再生される状態にします。
2. アプリの音声入力を「PC・会議タブの再生音」にして「会議を開始」。
3. ブラウザーの共有ダイアログで**会議のタブ**を選択し「タブの音声を共有」をONにして共有。
4. 左に英語と日本語、質問を検出すると右に回答例が表示されます。

### WindowsのTeams / Zoomデスクトップ版等

同じ操作で「画面全体」を選び、システム音声共有をONにします。OS・ブラウザーで音声共有が提供されない場合、ブラウザー版会議に切り替えてタブ音声を選んでください。「ウィンドウ」を選んでも音声が含まれない場合があります。

### 対面会議／音声共有が使えない場合

「マイク」を選択し、マイク使用を許可してください。スピーカーから出た音をマイクで拾うこともできますが、反響・周囲の雑音で精度が落ちます。可能ならPCの再生音の直接取得を使ってください。

画面共有の選択は毎回必要です。アプリが無操作でPC音声を取り始めることはできません。画面共有ストリームに映像トラックも含まれますが、コードは音声トラックだけを取り出して送信します。映像の描画・録画・送信はしません。

## 5. 会議中の使い方

- 「速度優先」「バランス」「精度優先」は次回の会議開始時に音声認識へ反映されます。切替時は停止→再開。
- 英語の認識途中と日本語の暫定訳は修正されることがあります。数字・否定・日時は確定した原文も確認してください。
- 自動判定は相手からの質問候補です。発言者・宛先の特定は行いません。質問を見逃した場合は発言の「この発言への回答例」を押してください。
- 誤認識は正しい英文を手入力欄に入れて再実行できます。既存原文を上書きせず別の発言として追加します。
- 回答例は自動読み上げ・自動送信しません。確認して英文をコピーし、ご自身で発言してください。
- 「停止」で音声取得・接続を終了。最後の確定済み発言の翻訳等は処理を続けます。閉じる前に「履歴を保存」でテキストをダウンロードできます。
- 1接続の上限は60分。60分に達したら、再度「会議を開始」してください。会議履歴は画面に残りますが、停止中・再接続中の音声は取得しません。
- メモリー内の履歴はタブを閉じると消えます。ブラウザーの復元による保持は保証しません。

## 6. デスクトップのアプリウィンドウとして使う

Chrome / Edgeで公開URLを開き、ブラウザーの「インストール」「このサイトをアプリとしてインストール」または「ページをアプリとしてインストール」などを使用してください。項目名・提供可否はブラウザーバージョンによります。表示されない場合は「ショートカットを作成」からウィンドウ表示するか、ブラウザータブで利用できます。これはWebアプリであり、Windowsのexeではありません。オフラインでは認識・翻訳できません。

## トラブル対応

| 状況 | 対応 |
| --- | --- |
| 音声が共有されていない | タブか画面全体を選び直して音声共有をON。ブラウザー版会議を試す |
| 音声レベルが0のまま | 相手が話しているか、正しいタブか、PC音量を確認。マイク入力でも切り分け |
| 401 / 認証不一致 | APP_TOKENの前後空白・取り違えを確認。OpenAI由来401ならAPIキーを確認 |
| 403 / 接続元エラー | ALLOWED_ORIGINSは `https://ユーザー名.github.io`。リポジトリ名と末尾 `/` を外す |
| 429 | API利用上限・Workerレート制限を確認し、時間を置いて再実行 |
| 503 | WorkerのOPENAI_API_KEYと32文字以上のAPP_TOKENのSecretを確認 |
| 音声APIのモデルエラー | gpt-live-transcribeへのAPI権限と現行ドキュメントを確認。他の音声モデルへの単純置換は設定形式が異なるため不可 |
| 会社PCで接続できない | HTTPS/WSS通信、マイク・画面共有、Cloudflare/OpenAIへのアクセスを社内管理者へ確認 |
| 字幕がたまって遅い | ネットワーク・API制限を確認。不要なアプリを閉じる。長時間時は履歴保存・消去も検討 |
| GitHub Pagesが404 | main /docs の設定と、docs直下のindex.htmlを確認。ファイルの二重フォルダ化に注意 |
| ローカルHTMLを直接開いて動かない | GitHub PagesのHTTPS URLで開く。file://ではモジュール・音声APIが制約を受ける |

ローカルで開発する場合は `python -m http.server 8765` などで配信し、`http://localhost:8765` をALLOWED_ORIGINSへ追加します。複数指定はカンマ区切りです。本番配備時は不要なオリジンを削除してください。

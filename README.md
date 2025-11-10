# DeepL PDF Translator

PDFファイルをDeepL APIを使用して高品質に翻訳するWebサービスです。モダンでスタイリッシュなUIを提供し、ドラッグ&ドロップでファイルをアップロードできます。

## 機能

### 主要機能
- 📄 **PDFファイルの翻訳**: PDFからテキストを抽出し、DeepL APIで翻訳
- 🎨 **モダンなUI**: スタイリッシュでプロフェッショナルなデザイン
- 🖱️ **ドラッグ&ドロップ対応**: 直感的なファイルアップロード
- 🌍 **多言語対応**: DeepLが対応する主要言語をサポート
- 🔒 **セキュリティ**: API Keyはサーバーサイドで管理（クライアントから見えない）

### 運用管理機能
- 📊 **アクセスログ**: IPアドレス、翻訳ページ数、文字数を記録
- 📅 **日付別ログ**: 日ごとにJSON形式でログを保存
- 🔐 **管理者パスワード保護**: ログへのアクセスは認証が必要

## プロジェクト構造

deepl-translator/ ├── public/ │ └── index.html # フロントエンドUI ├── logs/ # 翻訳ログ（自動生成） ├── server.js # バックエンドサーバー ├── package.json # 依存関係 ├── .env # 環境変数（APIキー） ├── .env.example # 環境変数のサンプル ├── .gitignore # Git無視ファイル └── README.md # このファイル


## セットアップ方法

### 1. リポジトリのクローン

```bash
git clone <your-repository-url>
cd deepl-translator
2. 依存関係のインストール
npm install
3. 環境変数の設定
.envファイルを作成し、以下の情報を設定：

DEEPL_API_KEY=your_deepl_api_key_here
PORT=3000
NODE_ENV=production
ADMIN_PASSWORD=your_admin_password_here
4. サーバーの起動
開発モード（自動再起動）
npm run dev
本番モード
npm start
サーバーは http://localhost:3000 で起動します。

デプロイ方法
このアプリケーションは、Node.jsをサポートする以下のプラットフォームにデプロイできます：

Railway でのデプロイ
Railway にアクセス
GitHubリポジトリを接続
環境変数を設定：
DEEPL_API_KEY: あなたのDeepL APIキー
ADMIN_PASSWORD: 管理者パスワード
デプロイを実行
Heroku でのデプロイ
Heroku CLIをインストール
プロジェクトディレクトリで以下を実行：
heroku create your-app-name
heroku config:set DEEPL_API_KEY=your_api_key
heroku config:set ADMIN_PASSWORD=your_password
git push heroku main
Render でのデプロイ
Render にアクセス
新しいWeb Serviceを作成
GitHubリポジトリを接続
ビルドコマンド: npm install
起動コマンド: npm start
環境変数を設定
API エンドポイント
POST /api/translate
PDFファイルを翻訳します。

リクエスト:

Method: POST
Content-Type: multipart/form-data
Body:
file: PDFファイル（最大10MB）
targetLang: 翻訳先言語コード（例: "JA", "EN-US"）
sourceLang: 翻訳元言語コード（省略可、自動検出）
レスポンス:

翻訳済みPDFファイル（ダウンロード）
GET /api/languages
DeepLがサポートする言語リストを取得します。

レスポンス:

[
  {
    "language": "JA",
    "name": "Japanese"
  },
  ...
]
GET /api/logs
翻訳ログを取得します（管理者のみ）。

クエリパラメータ:

password: 管理者パスワード（必須）
date: 取得する日付（YYYY-MM-DD形式、省略可）
レスポンス:

{
  "logs": [
    {
      "timestamp": "2024-01-01T12:00:00.000Z",
      "ip": "192.168.1.1",
      "sourceLanguage": "EN",
      "targetLanguage": "JA",
      "pageCount": 5,
      "characterCount": 1234,
      "fileName": "document.pdf"
    }
  ]
}
GET /api/health
サーバーの状態を確認します。

レスポンス:

{
  "status": "OK",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "apiKeyConfigured": true
}
使用方法
ブラウザで http://localhost:3000 にアクセス
PDFファイルをドラッグ&ドロップ、またはクリックして選択
翻訳元言語を選択（自動検出も可能）
翻訳先言語を選択
「翻訳する」ボタンをクリック
翻訳済みPDFが自動的にダウンロードされます
ログの確認
ログファイルは logs/ ディレクトリに日付別に保存されます：

logs/
├── translations_2024-01-01.json
├── translations_2024-01-02.json
└── ...
API経由でログを確認
# 全ログを取得
curl "http://localhost:3000/api/logs?password=your_admin_password"

# 特定日のログを取得
curl "http://localhost:3000/api/logs?password=your_admin_password&date=2024-01-01"
セキュリティ
✅ DeepL API Keyは環境変数で管理
✅ API Keyはクライアントに公開されない
✅ ファイルサイズ制限（10MB）
✅ PDFファイルのみアップロード可能
✅ ログへのアクセスはパスワード保護
✅ IPアドレスを記録（不正利用の監視）
技術スタック
バックエンド: Node.js + Express
PDF処理: pdf-parse, pdf-lib
翻訳API: DeepL API
フロントエンド: HTML5, CSS3, Vanilla JavaScript
今後の拡張機能（予定）

複数ファイルの一括翻訳

翻訳履歴のダッシュボード

ユーザー認証システム

翻訳品質の評価機能

Word/Excel形式のサポート

キャッシュ機能（同じ内容の再翻訳を防止）
トラブルシューティング
PDFからテキストを抽出できない
スキャンされた画像のPDFは非対応です（OCR機能が必要）
保護されたPDFは翻訳できません
DeepL API エラー
API Keyが正しいか確認してください
DeepL APIの利用制限に達していないか確認してください
無料版APIキーを使用している場合は、有料版のエンドポイントと間違えていないか確認してください
ファイルサイズエラー
10MB以下のファイルのみアップロード可能です
必要に応じて server.js の limits.fileSize を変更してください
ライセンス
MIT License

お問い合わせ
問題や質問がある場合は、GitHubのIssuesで報告してください。
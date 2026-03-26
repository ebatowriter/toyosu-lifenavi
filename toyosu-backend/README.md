# 豊洲ライフナビ — バックエンド構築・デプロイガイド

## 📁 ディレクトリ構成

```
toyosu-backend/
├── app.js                  # メインサーバー（エントリーポイント）
├── .env.example            # 環境変数テンプレート
├── db/
│   └── index.js            # NeDBデータベース初期化
├── middleware/
│   └── auth.js             # JWT認証ミドルウェア
├── routes/
│   ├── auth.js             # 認証API（登録/ログイン/リフレッシュ）
│   ├── billing.js          # Stripe課金・Webhook
│   ├── chat.js             # Claude AIチャット
│   ├── user.js             # ユーザー管理
│   └── contact.js          # お問い合わせフォーム
└── services/
    └── mail.js             # メール送信（nodemailer）

toyosu-app/                 # フロントエンドHTML群
└── api-client.js           # 追加: バックエンドAPI接続クライアント
```

---

## 🚀 ローカル起動手順

### 1. 環境変数を設定する

```bash
cd toyosu-backend
cp .env.example .env
# .env を編集して各項目を設定
```

### 2. 必要な設定項目

| 変数名 | 取得場所 | 説明 |
|--------|---------|------|
| `JWT_SECRET` | `openssl rand -base64 64` で生成 | 64文字以上のランダム文字列 |
| `STRIPE_SECRET_KEY` | Stripe Dashboard > APIキー | `sk_live_...` |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard > APIキー | `pk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard > Webhook | `whsec_...` |
| `STRIPE_PRICE_STANDARD` | Stripe Dashboard > 商品 | スタンダードの価格ID |
| `STRIPE_PRICE_PREMIUM` | Stripe Dashboard > 商品 | プレミアムの価格ID |
| `ANTHROPIC_API_KEY` | console.anthropic.com | `sk-ant-...` |
| `SMTP_USER` / `SMTP_PASS` | Gmail > App Password | Gmailアプリパスワード |
| `FRONTEND_URL` | 本番ドメイン | `https://toyosu-lifenavi.jp` |

### 3. サーバー起動

```bash
npm install
npm start
# → http://localhost:3000 で起動
```

---

## 🎛 Stripe設定手順

### 1. 商品・価格を作成

Stripe Dashboard > 商品 > 「商品を追加」

| 商品名 | 価格 | 課金期間 | 備考 |
|--------|------|---------|------|
| スタンダードプラン | ¥2,980 | 月次 | メタデータに `plan=standard` |
| プレミアムプラン | ¥4,980 | 月次 | メタデータに `plan=premium` |

### 2. Webhookを設定

Stripe Dashboard > Developer > Webhooks > 「エンドポイントを追加」

```
URL: https://toyosu-lifenavi.jp/api/billing/webhook
リッスンするイベント:
  - checkout.session.completed
  - customer.subscription.updated
  - customer.subscription.deleted
  - invoice.payment_failed
```

### 3. カスタマーポータルを有効化

Stripe Dashboard > Settings > Billing > Customer portal > 有効化

---

## ☁️ 本番デプロイ（Render.com — 推奨）

Renderは無料tierから使え、Node.jsのデプロイが最も簡単です。

### 1. GitHubにpush

```bash
# .gitignore を作成
cat > .gitignore << 'EOF'
node_modules/
.env
data/
*.db
EOF

git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/toyosu-lifenavi.git
git push -u origin main
```

### 2. Render.comでWebサービスを作成

1. https://render.com でサインアップ
2. 「New Web Service」をクリック
3. GitHubリポジトリを接続
4. 設定:
   - **Root Directory**: `toyosu-backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Node Version**: `18`
5. Environment Variables に `.env` の内容を全て入力
6. 「Create Web Service」でデプロイ

### 3. カスタムドメインを設定

Render Dashboard > Settings > Custom Domains:
`toyosu-lifenavi.jp` を追加し、DNSをRenderに向ける

---

## 🔌 フロントエンドとの接続

`toyosu-app/index.html` に以下を追加（`<body>` の最後、既存 `<script>` の前）:

```html
<script src="api-client.js"></script>
```

既存のフロント側でのStripe直接呼び出し・Claude API直接呼び出しは `api-client.js` の関数に置き換えます。

### 主な関数の対応表

| 旧（フロント直接） | 新（バックエンド経由） |
|---|---|
| `stripe.redirectToCheckout(...)` | `BillingAPI.startCheckout('standard')` |
| `fetch('https://api.anthropic.com/...')` | `ChatAPI.sendMessage(messages, room, onChunk, onDone, onError)` |
| `localStorage.setItem('toyosu_user', ...)` | `AuthAPI.login(email, password)` |

---

## 📡 APIエンドポイント一覧

### 認証
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/auth/register` | 新規登録 |
| POST | `/api/auth/login` | ログイン |
| POST | `/api/auth/refresh` | トークン更新 |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | 現在のユーザー情報 |
| GET | `/api/auth/verify-email/:token` | メール確認 |

### 課金
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/billing/checkout` | Checkoutセッション作成 |
| POST | `/api/billing/portal` | カスタマーポータル起動 |
| GET | `/api/billing/subscription` | サブスクリプション情報 |
| POST | `/api/billing/webhook` | Stripe Webhook受信 |

### AIチャット
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/chat` | チャットメッセージ送信（SSEストリーミング） |
| GET | `/api/chat/usage` | 今月の使用量 |
| GET | `/api/chat/history` | チャット履歴 |

### その他
| Method | Path | 説明 |
|--------|------|------|
| PATCH | `/api/user/profile` | プロフィール更新 |
| PATCH | `/api/user/password` | パスワード変更 |
| DELETE | `/api/user/account` | アカウント削除 |
| POST | `/api/contact` | お問い合わせ送信 |
| GET | `/api/health` | ヘルスチェック |

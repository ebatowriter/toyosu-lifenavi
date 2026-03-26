// app.js — 豊洲ライフナビ バックエンドサーバー
'use strict';
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initIndexes } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================================
// セキュリティ・共通ミドルウェア
// ====================================================
app.set('trust proxy', 1);

// Stripe Webhookは raw body が必要なため最初に登録
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", 'js.stripe.com', 'fonts.googleapis.com', 'unpkg.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      frameSrc: ['js.stripe.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
}));

// CORS設定
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:8080',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: ${origin} は許可されていません`));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// グローバルレート制限（1IP 15分に300リクエストまで）
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'リクエストが多すぎます。しばらくしてからお試しください。' },
}));

// ====================================================
// 静的ファイル配信（フロントエンドHTML）
// ====================================================
app.use(express.static(path.join(__dirname, '../toyosu-app'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ====================================================
// API ルート
// ====================================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/user', require('./routes/user'));
app.use('/api/contact', require('./routes/contact'));

// ====================================================
// ヘルスチェック
// ====================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: '豊洲ライフナビ API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ====================================================
// フロントエンドのSPAフォールバック
// ====================================================
app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'エンドポイントが見つかりません' });
  }
  res.sendFile(path.join(__dirname, '../toyosu-app/index.html'));
});

// ====================================================
// エラーハンドラー
// ====================================================
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'サーバーエラーが発生しました'
      : err.message,
  });
});

// ====================================================
// サーバー起動
// ====================================================
async function start() {
  try {
    await initIndexes();
    app.listen(PORT, () => {
      console.log(`\n🗼 豊洲ライフナビ バックエンドサーバー起動`);
      console.log(`   URL: http://localhost:${PORT}`);
      console.log(`   環境: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   フロントエンド: ${process.env.FRONTEND_URL}\n`);
    });
  } catch (err) {
    console.error('サーバー起動エラー:', err);
    process.exit(1);
  }
}

start();

module.exports = app;

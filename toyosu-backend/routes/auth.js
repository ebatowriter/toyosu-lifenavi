// routes/auth.js — 認証エンドポイント
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../services/mail');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// レート制限: ログイン・登録は1IP 15分に10回まで
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'リクエストが多すぎます。しばらくしてからお試しください。' },
});

// ====================================================
// POST /api/auth/register — 新規ユーザー登録
// ====================================================
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // バリデーション
    if (!email || !password || !name) {
      return res.status(400).json({ error: '全ての項目を入力してください' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'パスワードは8文字以上で設定してください' });
    }

    // 既存チェック
    const existing = await db.users.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
    }

    // パスワードハッシュ化
    const passwordHash = await bcrypt.hash(password, 12);

    // メール確認トークン生成
    const emailVerifyToken = uuidv4();

    // ユーザー作成
    const user = await db.users.insert({
      email: email.toLowerCase(),
      passwordHash,
      name,
      plan: 'none', // Stripe課金後に 'standard' or 'premium' に変更
      emailVerified: false,
      emailVerifyToken,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // ウェルカムメール送信
    await sendWelcomeEmail(user.email, user.name, emailVerifyToken).catch(console.error);

    // JWTトークン発行
    const { accessToken, refreshToken } = await issueTokens(user._id);

    res.status(201).json({
      message: '登録が完了しました。確認メールをご確認ください。',
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error('[AUTH] register error:', err);
    if (err.errorType === 'uniqueViolated') {
      return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
    }
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// POST /api/auth/login — ログイン
// ====================================================
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
    }

    const user = await db.users.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
    }

    if (user.banned) {
      return res.status(403).json({ error: 'このアカウントは停止されています' });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
    }

    // 最終ログイン時刻更新
    await db.users.update({ _id: user._id }, { $set: { lastLoginAt: new Date().toISOString() } });

    const { accessToken, refreshToken } = await issueTokens(user._id);

    res.json({
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error('[AUTH] login error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// POST /api/auth/refresh — アクセストークン更新
// ====================================================
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: 'リフレッシュトークンが必要です' });
    }

    // DBでトークン検索
    const tokenDoc = await db.refreshTokens.findOne({ token: refreshToken });
    if (!tokenDoc || new Date(tokenDoc.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'セッションが期限切れです。再ログインしてください。', code: 'REFRESH_EXPIRED' });
    }

    // 古いトークンを削除（ローテーション）
    await db.refreshTokens.remove({ token: refreshToken });

    // 新しいトークンペアを発行
    const { accessToken, refreshToken: newRefreshToken } = await issueTokens(tokenDoc.userId);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error('[AUTH] refresh error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// POST /api/auth/logout — ログアウト
// ====================================================
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await db.refreshTokens.remove({ token: refreshToken }, { multi: false });
    }
    res.json({ message: 'ログアウトしました' });
  } catch (err) {
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// GET /api/auth/me — ログイン中ユーザー情報取得
// ====================================================
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: req.user.id });
    if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    // サブスクリプション情報も付加
    const subscription = await db.subscriptions.findOne({ userId: req.user.id });

    res.json({
      user: sanitizeUser(user),
      subscription: subscription ? {
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// GET /api/auth/verify-email/:token — メール確認
// ====================================================
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await db.users.findOne({ emailVerifyToken: token });
    if (!user) {
      return res.status(400).send('<h2>無効または期限切れのリンクです。</h2>');
    }
    await db.users.update(
      { _id: user._id },
      { $set: { emailVerified: true, emailVerifyToken: null, updatedAt: new Date().toISOString() } }
    );
    res.redirect(`${process.env.FRONTEND_URL}/?verified=1`);
  } catch (err) {
    res.status(500).send('<h2>サーバーエラーが発生しました。</h2>');
  }
});

// ====================================================
// Helpers
// ====================================================
async function issueTokens(userId) {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const refreshToken = uuidv4();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.refreshTokens.insert({
    token: refreshToken,
    userId,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  });

  return { accessToken, refreshToken };
}

function sanitizeUser(user) {
  const { passwordHash, emailVerifyToken, banned, ...safe } = user;
  return safe;
}

module.exports = router;

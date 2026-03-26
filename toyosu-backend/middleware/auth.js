// middleware/auth.js — JWT認証ミドルウェア
const jwt = require('jsonwebtoken');
const { db } = require('../db');

/**
 * リクエストヘッダーまたはCookieからJWTを検証し、
 * req.user にユーザー情報をセットするミドルウェア
 */
async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: '認証が必要です', code: 'UNAUTHORIZED' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // DBからユーザーを取得（削除済み・バン済みのチェック）
    const user = await db.users.findOne({ _id: decoded.userId });
    if (!user || user.banned) {
      return res.status(401).json({ error: 'アカウントが無効です', code: 'ACCOUNT_INVALID' });
    }

    req.user = {
      id: user._id,
      email: user.email,
      plan: user.plan || 'none',
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'セッションが期限切れです', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: '無効な認証情報です', code: 'INVALID_TOKEN' });
  }
}

/**
 * サブスクリプションが有効なユーザーのみ通過させるミドルウェア
 */
async function requireSubscription(req, res, next) {
  await requireAuth(req, res, async () => {
    if (req.user.plan === 'none') {
      return res.status(403).json({
        error: 'この機能はサブスクリプション会員限定です',
        code: 'SUBSCRIPTION_REQUIRED',
        upgradeUrl: '/pricing.html',
      });
    }
    next();
  });
}

/**
 * プレミアムプランのみ通過させるミドルウェア
 */
async function requirePremium(req, res, next) {
  await requireSubscription(req, res, async () => {
    if (req.user.plan !== 'premium') {
      return res.status(403).json({
        error: 'この機能はプレミアムプラン限定です',
        code: 'PREMIUM_REQUIRED',
        upgradeUrl: '/pricing.html',
      });
    }
    next();
  });
}

function extractToken(req) {
  // Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Cookie: access_token=<token>
  if (req.cookies?.access_token) {
    return req.cookies.access_token;
  }
  return null;
}

module.exports = { requireAuth, requireSubscription, requirePremium };

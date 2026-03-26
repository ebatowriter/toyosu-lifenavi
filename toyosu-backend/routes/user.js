// routes/user.js — ユーザー管理エンドポイント
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

// ====================================================
// PATCH /api/user/profile — プロフィール更新
// ====================================================
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name.trim().length < 1) {
      return res.status(400).json({ error: '名前を入力してください' });
    }

    await db.users.update(
      { _id: req.user.id },
      { $set: { name: name.trim(), updatedAt: new Date().toISOString() } }
    );

    const updated = await db.users.findOne({ _id: req.user.id });
    const { passwordHash, emailVerifyToken, banned, ...safe } = updated;
    res.json({ user: safe });
  } catch (err) {
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// PATCH /api/user/password — パスワード変更
// ====================================================
router.patch('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '現在のパスワードと新しいパスワードを入力してください' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: '新しいパスワードは8文字以上で設定してください' });
    }

    const user = await db.users.findOne({ _id: req.user.id });
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: '現在のパスワードが正しくありません' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.users.update(
      { _id: req.user.id },
      { $set: { passwordHash: newHash, updatedAt: new Date().toISOString() } }
    );

    // 全リフレッシュトークン無効化（セキュリティのため）
    await db.refreshTokens.remove({ userId: req.user.id }, { multi: true });

    res.json({ message: 'パスワードを変更しました。再ログインしてください。' });
  } catch (err) {
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// DELETE /api/user/account — アカウント削除
// ====================================================
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'パスワードを入力してください' });
    }

    const user = await db.users.findOne({ _id: req.user.id });
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'パスワードが正しくありません' });
    }

    // サブスクリプションがあれば警告
    const sub = await db.subscriptions.findOne({
      userId: req.user.id,
      status: { $in: ['active', 'trialing'] },
    });
    if (sub) {
      return res.status(409).json({
        error: 'アクティブなサブスクリプションがあります。先に解約してからアカウントを削除してください。',
        code: 'ACTIVE_SUBSCRIPTION',
      });
    }

    // データ削除
    await db.users.remove({ _id: req.user.id });
    await db.refreshTokens.remove({ userId: req.user.id }, { multi: true });
    await db.chats.remove({ userId: req.user.id }, { multi: true });
    await db.usage.remove({ userId: req.user.id }, { multi: true });

    res.json({ message: 'アカウントを削除しました' });
  } catch (err) {
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

module.exports = router;

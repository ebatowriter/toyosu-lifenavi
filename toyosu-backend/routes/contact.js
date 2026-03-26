// routes/contact.js — お問い合わせフォーム処理
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendContactAutoReply, sendContactNotification } = require('../services/mail');

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1時間
  max: 5,
  message: { error: '送信回数の上限に達しました。しばらくしてからお試しください。' },
});

// POST /api/contact
router.post('/', contactLimiter, async (req, res) => {
  try {
    const { name, email, type, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: '必須項目を入力してください' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'メッセージは2000文字以内で入力してください' });
    }

    // 自動返信 + スタッフ通知（並列送信）
    await Promise.allSettled([
      sendContactAutoReply(email, name, type || 'お問い合わせ'),
      sendContactNotification({ name, email, type: type || 'その他', message }),
    ]);

    res.json({ message: 'お問い合わせを受け付けました。確認メールをご確認ください。' });
  } catch (err) {
    console.error('[CONTACT] error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

module.exports = router;

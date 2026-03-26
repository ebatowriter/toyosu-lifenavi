// services/mail.js — メール送信サービス
const nodemailer = require('nodemailer');

// トランスポーター初期化
let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

// ====================================================
// 共通HTMLテンプレート
// ====================================================
function wrapHtml(title, body) {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<style>
  body { margin:0; padding:0; background:#f5f0e8; font-family:'Noto Sans JP',sans-serif; }
  .wrap { max-width:600px; margin:40px auto; background:white; border-radius:8px; overflow:hidden; box-shadow:0 4px 24px rgba(15,30,56,0.1); }
  .header { background:#0f1e38; padding:28px 32px; }
  .header-logo { color:#c9a84c; font-size:18px; font-weight:700; letter-spacing:0.05em; }
  .header-sub { color:rgba(255,255,255,0.5); font-size:12px; margin-top:4px; }
  .body { padding:32px; }
  .body h2 { color:#0f1e38; font-size:20px; margin:0 0 16px; }
  .body p { color:#6b6560; font-size:14px; line-height:1.8; margin:0 0 12px; }
  .btn { display:inline-block; background:#c9a84c; color:#0f1e38; font-weight:700; font-size:14px; padding:14px 28px; border-radius:4px; text-decoration:none; margin:16px 0; }
  .box { background:#f9f8f6; border:1px solid #e2ddd6; border-radius:4px; padding:16px 20px; margin:16px 0; }
  .box p { margin:0; font-size:13px; }
  .footer { background:#080f1e; padding:20px 32px; }
  .footer p { color:rgba(255,255,255,0.3); font-size:11px; margin:0; line-height:1.6; }
  .footer a { color:rgba(255,255,255,0.4); }
</style>
</head><body>
<div class="wrap">
  <div class="header">
    <div class="header-logo">豊洲ライフナビ</div>
    <div class="header-sub">TOYOSU LIFE NAVI</div>
  </div>
  <div class="body">
    <h2>${title}</h2>
    ${body}
  </div>
  <div class="footer">
    <p>このメールは豊洲ライフナビ（<a href="${process.env.FRONTEND_URL}">toyosu-lifenavi.jp</a>）から送信されました。<br>
    心当たりがない場合は、このメールを無視してください。<br>
    © 2026 豊洲ライフナビ All Rights Reserved.</p>
  </div>
</div>
</body></html>`;
}

// ====================================================
// ウェルカムメール（登録確認）
// ====================================================
async function sendWelcomeEmail(email, name, verifyToken) {
  try {
    const verifyUrl = `${process.env.FRONTEND_URL}/api/auth/verify-email/${verifyToken}`;
    const html = wrapHtml('豊洲ライフナビへようこそ！', `
      <p>${name} 様</p>
      <p>豊洲ライフナビにご登録いただき、ありがとうございます。</p>
      <p>以下のボタンからメールアドレスを確認してください。</p>
      <a href="${verifyUrl}" class="btn">メールアドレスを確認する</a>
      <div class="box">
        <p>ボタンが機能しない場合は、以下のURLをブラウザに貼り付けてください：<br>
        <a href="${verifyUrl}">${verifyUrl}</a></p>
      </div>
      <a href="${process.env.FRONTEND_URL}/pricing.html" class="btn" style="background:#0f1e38;color:#c9a84c">プランを選択する</a>
    `);
    await getTransporter().sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: '【豊洲ライフナビ】メールアドレスの確認をお願いします',
      html,
    });
  } catch (err) {
    console.error('[MAIL] sendWelcomeEmail failed (non-fatal):', err.message);
  }
}

// ====================================================
// サブスクリプション開始確認メール
// ====================================================
async function sendSubscriptionConfirmEmail(email, name, plan) {
  try {
    const planName = plan === 'premium' ? 'プレミアムプラン（¥4,980/月）' : 'スタンダードプラン（¥2,980/月）';
    const features = plan === 'premium'
      ? ['AIチャット無制限', '中学受験AIアドバイザー（フル機能）', '不動産資産価値シミュレーター詳細版', '防災プランナー個別プラン生成']
      : ['AIチャット（月100回）', '防災プランナー（基本版）', '資産価値情報', '医療・行政・子育て情報'];

    const html = wrapHtml('ご登録ありがとうございます', `
      <p>${name} 様</p>
      <p>豊洲ライフナビへのご登録が完了しました。</p>
      <div class="box">
        <p><strong>ご登録プラン：</strong>${planName}</p>
      </div>
      <ul style="color:#6b6560;font-size:14px;line-height:2">
        ${features.map(f => `<li>${f}</li>`).join('')}
      </ul>
      <a href="${process.env.FRONTEND_URL}/?app=1" class="btn">サービスを利用する</a>
    `);
    await getTransporter().sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: `【豊洲ライフナビ】${plan === 'premium' ? 'プレミアム' : 'スタンダード'}プランのご登録が完了しました`,
      html,
    });
  } catch (err) {
    console.error('[MAIL] sendSubscriptionConfirmEmail failed (non-fatal):', err.message);
  }
}

// ====================================================
// 解約完了メール
// ====================================================
async function sendCancellationEmail(email, name) {
  const html = wrapHtml('解約手続きが完了しました', `
    <p>${name} 様</p>
    <p>豊洲ライフナビのサブスクリプションの解約手続きが完了しました。</p>
    <p>ご利用期間中のサポートをありがとうございました。</p>
    <div class="box">
      <p>再びご利用の際は、いつでもお気軽にご登録ください。</p>
    </div>
    <a href="${process.env.FRONTEND_URL}/pricing.html" class="btn">再登録する</a>
    <p>サービスに関するご意見・ご要望がございましたら、<a href="${process.env.FRONTEND_URL}/contact.html">お問い合わせフォーム</a>からお寄せください。</p>
  `);

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: '【豊洲ライフナビ】解約手続きが完了しました',
    html,
  });
}

// ====================================================
// お問い合わせ受付メール（ユーザー向け自動返信）
// ====================================================
async function sendContactAutoReply(email, name, subject) {
  const html = wrapHtml('お問い合わせを受け付けました', `
    <p>${name} 様</p>
    <p>以下のお問い合わせを受け付けました。通常2営業日以内にご返答いたします。</p>
    <div class="box">
      <p><strong>件名：</strong>${subject}</p>
    </div>
    <p>緊急の場合は <a href="mailto:info@toyosu-lifenavi.jp">info@toyosu-lifenavi.jp</a> まで直接ご連絡ください。</p>
  `);

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: '【豊洲ライフナビ】お問い合わせを受け付けました',
    html,
  });
}

// ====================================================
// お問い合わせ通知メール（スタッフ向け）
// ====================================================
async function sendContactNotification(contactData) {
  const { name, email, type, message } = contactData;
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to: process.env.SMTP_USER,
    subject: `[お問い合わせ] ${type}: ${name}様`,
    text: `名前: ${name}\nメール: ${email}\n種別: ${type}\n\n${message}`,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendSubscriptionConfirmEmail,
  sendCancellationEmail,
  sendContactAutoReply,
  sendContactNotification,
};

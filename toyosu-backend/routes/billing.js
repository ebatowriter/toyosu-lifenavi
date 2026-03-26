// routes/billing.js — Stripe課金・Webhook処理
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendSubscriptionConfirmEmail, sendCancellationEmail } = require('../services/mail');

// ====================================================
// POST /api/billing/checkout — Stripe Checkoutセッション作成
// ====================================================
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body; // 'standard' or 'premium'
    if (!['standard', 'premium'].includes(plan)) {
      return res.status(400).json({ error: '無効なプランです' });
    }

    const user = await db.users.findOne({ _id: req.user.id });
    if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    const priceId = plan === 'premium'
      ? process.env.STRIPE_PRICE_PREMIUM
      : process.env.STRIPE_PRICE_STANDARD;

    // 既存のStripeカスタマーIDがあれば再利用
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id },
      });
      customerId = customer.id;
      await db.users.update(
        { _id: user._id },
        { $set: { stripeCustomerId: customerId, updatedAt: new Date().toISOString() } }
      );
    }

    // 既にアクティブサブスクリプションがある場合はポータルへ誘導
    const existingSub = await db.subscriptions.findOne({
      userId: req.user.id,
      status: { $in: ['active', 'trialing'] },
    });
    if (existingSub) {
      return res.status(409).json({
        error: '既にサブスクリプションが存在します。プランを変更するにはカスタマーポータルをご利用ください。',
        code: 'ALREADY_SUBSCRIBED',
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing.html?checkout=cancelled`,
      subscription_data: {
        metadata: { userId: req.user.id, plan },
      },
      locale: 'ja',
      allow_promotion_codes: true,
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('[BILLING] checkout error:', err);
    res.status(500).json({ error: 'チェックアウトセッションの作成に失敗しました' });
  }
});

// ====================================================
// POST /api/billing/portal — Stripeカスタマーポータル
// (プラン変更・解約・請求書確認はここで行う)
// ====================================================
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: req.user.id });
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'サブスクリプションが見つかりません' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/?portal=return`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[BILLING] portal error:', err);
    res.status(500).json({ error: 'カスタマーポータルの起動に失敗しました' });
  }
});

// ====================================================
// GET /api/billing/subscription — サブスクリプション情報取得
// ====================================================
router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const subscription = await db.subscriptions.findOne({ userId: req.user.id });
    if (!subscription) {
      return res.json({ subscription: null });
    }
    res.json({ subscription });
  } catch (err) {
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// POST /api/billing/webhook — Stripe Webhook処理
// ※ このルートはraw bodyが必要なため、app.jsで別処理
// ====================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] 署名検証失敗:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`[WEBHOOK] イベント受信: ${event.type}`);

  try {
    switch (event.type) {

      // === サブスクリプション作成（決済成功） ===
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;

        const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
        const userId = stripeSubscription.metadata.userId;
        const plan = stripeSubscription.metadata.plan;

        if (!userId) {
          console.error('[WEBHOOK] userId が metadata に見つかりません');
          break;
        }

        // サブスクリプションDBに保存
        await db.subscriptions.remove({ userId }, { multi: true });
        await db.subscriptions.insert({
          userId,
          plan,
          status: stripeSubscription.status,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: stripeSubscription.id,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // ユーザーのプランを更新
        await db.users.update(
          { _id: userId },
          { $set: { plan, stripeCustomerId: session.customer, updatedAt: new Date().toISOString() } }
        );

        // 登録確認メール送信
        const user = await db.users.findOne({ _id: userId });
        if (user) {
          await sendSubscriptionConfirmEmail(user.email, user.name, plan).catch(console.error);
        }

        console.log(`[WEBHOOK] サブスクリプション有効化: userId=${userId}, plan=${plan}`);
        break;
      }

      // === サブスクリプション更新 ===
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata.userId;
        const plan = sub.metadata.plan;

        if (!userId) break;

        await db.subscriptions.update(
          { stripeSubscriptionId: sub.id },
          {
            $set: {
              status: sub.status,
              plan: plan || (await getPlanFromSub(sub)),
              currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
              currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              updatedAt: new Date().toISOString(),
            },
          }
        );

        const newPlan = sub.status === 'active' ? plan : 'none';
        await db.users.update(
          { _id: userId },
          { $set: { plan: newPlan, updatedAt: new Date().toISOString() } }
        );

        console.log(`[WEBHOOK] サブスクリプション更新: userId=${userId}, status=${sub.status}`);
        break;
      }

      // === サブスクリプション解約 ===
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata.userId;

        if (!userId) break;

        await db.subscriptions.update(
          { stripeSubscriptionId: sub.id },
          { $set: { status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date().toISOString() } }
        );

        await db.users.update(
          { _id: userId },
          { $set: { plan: 'none', updatedAt: new Date().toISOString() } }
        );

        const user = await db.users.findOne({ _id: userId });
        if (user) {
          await sendCancellationEmail(user.email, user.name).catch(console.error);
        }

        console.log(`[WEBHOOK] サブスクリプション解約: userId=${userId}`);
        break;
      }

      // === 支払い失敗 ===
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.warn(`[WEBHOOK] 支払い失敗: customerId=${invoice.customer}`);
        // TODO: 支払い失敗メール送信
        break;
      }

      default:
        console.log(`[WEBHOOK] 未処理イベント: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK] 処理エラー:', err);
    res.status(500).json({ error: 'Webhook処理中にエラーが発生しました' });
  }
});

async function getPlanFromSub(sub) {
  // priceIdからプランを逆引き
  const priceId = sub.items?.data?.[0]?.price?.id;
  if (priceId === process.env.STRIPE_PRICE_PREMIUM) return 'premium';
  if (priceId === process.env.STRIPE_PRICE_STANDARD) return 'standard';
  return 'standard';
}

module.exports = router;

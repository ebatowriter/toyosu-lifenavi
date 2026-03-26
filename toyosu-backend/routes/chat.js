// routes/chat.js — Claude AIチャットエンドポイント
const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db');
const { requireSubscription } = require('../middleware/auth');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ====================================================
// チャットルーム別システムプロンプト
// ====================================================
const SYSTEM_PROMPTS = {
  general: `あなたは「豊洲ライフナビ」という豊洲タワマン住民専用AIアシスタントです。
東京都江東区豊洲（1〜6丁目）のタワーマンション住民の日常的な疑問・悩みをサポートします。
中学受験・防災・不動産資産価値・医療・子育て・行政手続きを中心に、豊洲エリアに特化した実践的なアドバイスを提供してください。
回答は日本語で、丁寧かつ具体的に。豊洲住民の世帯年収1200〜2000万円層向けのトーンで話してください。`,

  exam: `あなたは豊洲タワマン住民専用の「中学受験AIアドバイザー」です。
豊洲エリアの中学受験事情に精通しており、SAPIX豊洲校・日能研・早稲田アカデミーの特徴、
麻布・駒場東邦・桜蔭・女子学院などの志望校戦略、学年別の受験スケジュール管理、
共働き世帯の受験サポート体制、親の心理的サポートまで、豊洲の受験事情に特化したアドバイスを提供します。
「豊洲のSAPIXは競争が激しい」「中国系家庭の参入で競争が激化」といった現地事情も踏まえて回答してください。
回答は実践的・具体的に。受験まで時間のない親御さんの焦りに寄り添いながら、冷静で建設的なアドバイスをしてください。`,

  disaster: `あなたは豊洲タワマン住民専用の「防災プランナーAI」です。
豊洲エリアは埋立地（液状化リスク中〜高）・ゼロメートル地帯（浸水リスク高）という特性を持ちます。
有楽町線・ゆりかもめの2路線しかなく、大規模災害時は「島状孤立」するリスクがあります。
東日本大震災でのタワマン停電・エレベーター停止の実例も踏まえ、
居住マンション・居住階・家族構成に合わせた具体的な防災計画を提案してください。
江東区ハザードマップの解説、72時間備蓄リスト、避難場所案内も対応します。
絵空事でなく、「本当に使える」実践的な防災情報を提供してください。`,

  asset: `あなたは豊洲タワマン住民専用の「不動産資産価値AIアドバイザー」です。
豊洲エリアの最新坪単価（2025〜2026年データ：豊洲663万円、晴海672万円、勝鬨853万円等）、
有楽町線豊洲〜住吉間延伸（2030年代開業予定）の価格影響、
修繕積立金・管理費の長期シミュレーション、売却タイミングの判断基準を提供します。
「タワマン価格が必ず上がる」という幻想を排し、現実的なデータに基づいたアドバイスをしてください。
投資・売却に関しては、不動産投資は専門家への相談も推奨してください。`,

  medical: `あなたは豊洲タワマン住民専用の「医療ナビAI」です。
豊洲エリアの医療機関情報（江東区の豊洲周辺クリニック・病院）、
豊洲は急激な人口増加に医療機関の整備が追いついていない課題を抱えていること、
江東区の乳幼児医療費助成（マル子）・子ども医療費助成などの支援制度も案内します。
緊急性の高い症状については、ためらわず救急車を呼ぶよう案内してください。
医療相談はあくまでも参考情報として提供し、必ず医療機関への受診を推奨してください。`,
};

// ====================================================
// POST /api/chat — AIチャットメッセージ送信
// ====================================================
router.post('/', requireSubscription, async (req, res) => {
  try {
    const { messages, room = 'general' } = req.body;
    const userId = req.user.id;
    const plan = req.user.plan;

    // バリデーション
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'メッセージが必要です' });
    }

    // 最後のメッセージがuserであることを確認
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user') {
      return res.status(400).json({ error: '最後のメッセージはユーザーのものである必要があります' });
    }

    // 使用量チェック（スタンダードは月100回まで）
    if (plan === 'standard') {
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const usageDoc = await db.usage.findOne({ userId, month: currentMonth });
      const usedCount = usageDoc?.count || 0;

      if (usedCount >= 100) {
        return res.status(429).json({
          error: '今月のAIチャット上限（100回）に達しました。プレミアムプランにアップグレードすると無制限でご利用いただけます。',
          code: 'USAGE_LIMIT_EXCEEDED',
          usedCount,
          limit: 100,
          upgradeUrl: '/pricing.html',
        });
      }
    }

    // ルームのシステムプロンプトを選択
    const systemPrompt = SYSTEM_PROMPTS[room] || SYSTEM_PROMPTS.general;

    // メッセージを整形（最大20往復まで保持）
    const recentMessages = messages.slice(-20).map(m => ({
      role: m.role,
      content: String(m.content).slice(0, 4000), // 1メッセージ4000文字制限
    }));

    // Claude API呼び出し（ストリーミング）
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let fullResponse = '';

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: recentMessages,
    });

    stream.on('text', (text) => {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('message', async (message) => {
      // 使用量カウントアップ
      const currentMonth = new Date().toISOString().slice(0, 7);
      const existing = await db.usage.findOne({ userId, month: currentMonth });
      if (existing) {
        await db.usage.update({ userId, month: currentMonth }, { $inc: { count: 1 } });
      } else {
        await db.usage.insert({ userId, month: currentMonth, count: 1, createdAt: new Date().toISOString() });
      }

      // チャット履歴保存（直近30日分のみ保持）
      await db.chats.insert({
        userId,
        room,
        userMessage: lastMsg.content.slice(0, 500),
        assistantMessage: fullResponse.slice(0, 2000),
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        createdAt: new Date().toISOString(),
      });

      // 使用量情報を最終イベントで送信
      const updatedUsage = await db.usage.findOne({ userId, month: currentMonth });
      res.write(`data: ${JSON.stringify({
        type: 'done',
        usage: {
          count: updatedUsage?.count || 1,
          limit: plan === 'standard' ? 100 : null,
          plan,
        },
      })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      console.error('[CHAT] Claude API エラー:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'AIの応答中にエラーが発生しました。しばらく後にお試しください。' })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('[CHAT] エラー:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
  }
});

// ====================================================
// GET /api/chat/usage — 今月の使用量取得
// ====================================================
router.get('/usage', requireSubscription, async (req, res) => {
  try {
    const userId = req.user.id;
    const plan = req.user.plan;
    const currentMonth = new Date().toISOString().slice(0, 7);

    const usageDoc = await db.usage.findOne({ userId, month: currentMonth });
    res.json({
      count: usageDoc?.count || 0,
      limit: plan === 'standard' ? 100 : null,
      plan,
      month: currentMonth,
    });
  } catch (err) {
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// ====================================================
// GET /api/chat/history — チャット履歴取得
// ====================================================
router.get('/history', requireSubscription, async (req, res) => {
  try {
    const { room, limit = 20 } = req.query;
    const query = { userId: req.user.id };
    if (room) query.room = room;

    const history = await db.chats
      .find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit), 50))
      .exec();

    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

module.exports = router;

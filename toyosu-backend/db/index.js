// db/index.js — NeDB-based database layer
const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');

const DB_DIR = process.env.DB_DIR || './data';

// データディレクトリを作成
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = {
  // ユーザーテーブル
  users: Datastore.create({
    filename: path.join(DB_DIR, 'users.db'),
    autoload: true,
  }),

  // サブスクリプション管理
  subscriptions: Datastore.create({
    filename: path.join(DB_DIR, 'subscriptions.db'),
    autoload: true,
  }),

  // チャット履歴
  chats: Datastore.create({
    filename: path.join(DB_DIR, 'chats.db'),
    autoload: true,
  }),

  // AIチャット使用量 (月次リセット)
  usage: Datastore.create({
    filename: path.join(DB_DIR, 'usage.db'),
    autoload: true,
  }),

  // リフレッシュトークン
  refreshTokens: Datastore.create({
    filename: path.join(DB_DIR, 'refresh_tokens.db'),
    autoload: true,
  }),
};

async function initIndexes() {
  // users: email唯一インデックス
  await db.users.ensureIndex({ fieldName: 'email', unique: true });
  // subscriptions: userId インデックス
  await db.subscriptions.ensureIndex({ fieldName: 'userId' });
  await db.subscriptions.ensureIndex({ fieldName: 'stripeCustomerId' });
  await db.subscriptions.ensureIndex({ fieldName: 'stripeSubscriptionId' });
  // chats: userId + createdAt
  await db.chats.ensureIndex({ fieldName: 'userId' });
  await db.chats.ensureIndex({ fieldName: 'createdAt' });
  // usage: userId + month 複合
  await db.usage.ensureIndex({ fieldName: 'userId' });
  // refreshTokens: token インデックス
  await db.refreshTokens.ensureIndex({ fieldName: 'token', unique: true });
  await db.refreshTokens.ensureIndex({ fieldName: 'userId' });

  console.log('[DB] インデックス初期化完了');
}

module.exports = { db, initIndexes };

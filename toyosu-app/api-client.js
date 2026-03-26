// api-client.js — フロントエンドAPIクライアント
// index.htmlで読み込む。バックエンド経由でStripe・Claude・認証を処理する。

const API_BASE = '/api';

// ====================================================
// トークン管理
// ====================================================
const Auth = {
  getAccessToken: () => localStorage.getItem('access_token'),
  getRefreshToken: () => localStorage.getItem('refresh_token'),
  setTokens: (access, refresh) => {
    localStorage.setItem('access_token', access);
    if (refresh) localStorage.setItem('refresh_token', refresh);
  },
  clearTokens: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('toyosu_user');
  },
  getUser: () => {
    try { return JSON.parse(localStorage.getItem('toyosu_user') || 'null'); } catch { return null; }
  },
  setUser: (user) => localStorage.setItem('toyosu_user', JSON.stringify(user)),
  isLoggedIn: () => !!localStorage.getItem('access_token'),
};

// ====================================================
// 汎用APIリクエスト（自動トークンリフレッシュ付き）
// ====================================================
async function apiRequest(path, options = {}) {
  const token = Auth.getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // アクセストークン期限切れ → リフレッシュ試行
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.code === 'TOKEN_EXPIRED') {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        headers.Authorization = `Bearer ${Auth.getAccessToken()}`;
        res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      } else {
        handleLogout();
        throw new Error('SESSION_EXPIRED');
      }
    }
  }

  return res;
}

async function tryRefreshToken() {
  const refreshToken = Auth.getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    Auth.setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ====================================================
// 認証API
// ====================================================
const AuthAPI = {
  async register(email, password, name) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    Auth.setTokens(data.accessToken, data.refreshToken);
    Auth.setUser(data.user);
    return data;
  },

  async login(email, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    Auth.setTokens(data.accessToken, data.refreshToken);
    Auth.setUser(data.user);
    return data;
  },

  async logout() {
    const refreshToken = Auth.getRefreshToken();
    await apiRequest('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
    handleLogout();
  },

  async getMe() {
    const res = await apiRequest('/auth/me');
    if (!res.ok) throw new Error('認証情報の取得に失敗しました');
    const data = await res.json();
    Auth.setUser(data.user);
    return data;
  },
};

// ====================================================
// 課金API
// ====================================================
const BillingAPI = {
  async startCheckout(plan) {
    const res = await apiRequest('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // Stripe Checkoutページへリダイレクト
    window.location.href = data.url;
  },

  async openPortal() {
    const res = await apiRequest('/billing/portal', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    window.location.href = data.url;
  },

  async getSubscription() {
    const res = await apiRequest('/billing/subscription');
    if (!res.ok) return null;
    const data = await res.json();
    return data.subscription;
  },
};

// ====================================================
// AIチャットAPI（ストリーミング対応）
// ====================================================
const ChatAPI = {
  async sendMessage(messages, room = 'general', onChunk, onDone, onError) {
    const token = Auth.getAccessToken();
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages, room }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.code === 'USAGE_LIMIT_EXCEEDED') {
          onError?.(data.error, 'USAGE_LIMIT_EXCEEDED');
          return;
        }
        if (data.code === 'SUBSCRIPTION_REQUIRED') {
          onError?.(data.error, 'SUBSCRIPTION_REQUIRED');
          return;
        }
        onError?.(data.error || 'エラーが発生しました');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text') onChunk?.(event.text);
            if (event.type === 'done') onDone?.(event.usage);
            if (event.type === 'error') onError?.(event.message);
          } catch {}
        }
      }
    } catch (err) {
      if (err.message === 'SESSION_EXPIRED') {
        onError?.('セッションが期限切れです。再ログインしてください。', 'SESSION_EXPIRED');
      } else {
        onError?.(err.message || 'ネットワークエラーが発生しました');
      }
    }
  },

  async getUsage() {
    const res = await apiRequest('/chat/usage');
    if (!res.ok) return null;
    return res.json();
  },
};

// ====================================================
// お問い合わせAPI
// ====================================================
const ContactAPI = {
  async send(name, email, type, message) {
    const res = await fetch(`${API_BASE}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, type, message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  },
};

// ====================================================
// ユーティリティ
// ====================================================
function handleLogout() {
  Auth.clearTokens();
  // ログインページまたはランディングページへリダイレクト
  if (window.location.pathname !== '/' && !window.location.pathname.includes('index')) {
    window.location.href = '/';
  } else {
    // index.htmlのshowLanding()を呼び出す
    if (typeof showLanding === 'function') showLanding();
  }
}

// URLパラメータのチェック（Stripe決済完了・キャンセル）
window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);

  // 決済成功
  if (params.get('checkout') === 'success') {
    if (Auth.isLoggedIn()) {
      await AuthAPI.getMe().catch(() => {});
    }
    window.history.replaceState({}, '', window.location.pathname);
    if (typeof showApp === 'function') showApp();
    alert('✅ ご登録ありがとうございます！豊洲ライフナビをご利用いただけます。');
    return;
  }

  // メール確認完了
  if (params.get('verified') === '1') {
    window.history.replaceState({}, '', window.location.pathname);
    alert('✅ メールアドレスの確認が完了しました。');
  }

  // 自動ログイン（既存セッションがある場合のみ）
  if (Auth.isLoggedIn()) {
    try {
      const { user } = await AuthAPI.getMe();
      if (user && user.plan !== 'none' && typeof showApp === 'function') {
        showApp();
      }
    } catch {
      // トークンが無効な場合はクリア（エラーは出さない）
      Auth.clearTokens();
    }
  }
});

// グローバルに公開
window.Auth = Auth;
window.AuthAPI = AuthAPI;
window.BillingAPI = BillingAPI;
window.ChatAPI = ChatAPI;
window.ContactAPI = ContactAPI;

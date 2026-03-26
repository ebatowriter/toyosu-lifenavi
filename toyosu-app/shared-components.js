/* shared-components.js — inject nav + footer into every subpage */

const NAV_HTML = `
<nav>
  <a href="index.html" class="nav-brand">
    <div class="nav-logo">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0f1e38" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </div>
    <span class="nav-title">豊洲<span>ライフナビ</span></span>
  </a>
  <ul class="nav-links" id="nav-links">
    <li><a href="features.html">機能一覧</a></li>
    <li><a href="pricing.html">料金プラン</a></li>
    <li><a href="faq.html">よくある質問</a></li>
    <li><a href="area.html">対応エリア</a></li>
    <li><a href="index.html#hero" class="nav-cta">今すぐ始める</a></li>
  </ul>
  <button class="hamburger" onclick="toggleNav()" id="hamburger" aria-label="メニュー">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
  </button>
</nav>`;

const FOOTER_HTML = `
<footer>
  <div class="footer-inner">
    <div class="footer-grid">
      <div>
        <div class="footer-brand-name">豊洲ライフナビ</div>
        <p class="footer-brand-desc">豊洲・湾岸タワマン住民専用のAI情報サービス。中学受験・防災・資産価値・子育て・医療をトータルサポートします。将来は勝鬨・月島・銀座エリアへも展開予定。</p>
      </div>
      <div>
        <div class="footer-col-title">サービス</div>
        <ul class="footer-links">
          <li><a href="features.html">機能一覧</a></li>
          <li><a href="pricing.html">料金プラン</a></li>
          <li><a href="faq.html">よくある質問</a></li>
          <li><a href="area.html">対応エリア</a></li>
        </ul>
      </div>
      <div>
        <div class="footer-col-title">情報</div>
        <ul class="footer-links">
          <li><a href="guide-exam.html">豊洲 中学受験ガイド</a></li>
          <li><a href="guide-disaster.html">豊洲 防災マップ</a></li>
          <li><a href="guide-asset.html">タワマン資産価値</a></li>
          <li><a href="guide-childcare.html">江東区 子育て情報</a></li>
        </ul>
      </div>
      <div>
        <div class="footer-col-title">会社情報</div>
        <ul class="footer-links">
          <li><a href="company.html">運営会社</a></li>
          <li><a href="contact.html">お問い合わせ</a></li>
          <li><a href="tokusho.html">特定商取引法</a></li>
          <li><a href="privacy.html">プライバシーポリシー</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span class="footer-copy">&copy; 2026 豊洲ライフナビ All Rights Reserved.</span>
      <div class="footer-legal">
        <a href="privacy.html">プライバシーポリシー</a>
        <a href="tokusho.html">特定商取引法に基づく表示</a>
        <a href="terms.html">利用規約</a>
      </div>
    </div>
  </div>
</footer>`;

function injectNav() {
  const el = document.getElementById('nav-placeholder');
  if (el) el.outerHTML = NAV_HTML;
  else document.body.insertAdjacentHTML('afterbegin', NAV_HTML);
}
function injectFooter() {
  const el = document.getElementById('footer-placeholder');
  if (el) el.outerHTML = FOOTER_HTML;
  else document.body.insertAdjacentHTML('beforeend', FOOTER_HTML);
}
function toggleNav() {
  const links = document.getElementById('nav-links');
  const open = links.classList.toggle('nav-open');
  if (open) {
    links.style.cssText = 'display:flex;flex-direction:column;position:fixed;top:64px;left:0;right:0;background:rgba(15,30,56,0.98);padding:1rem 2rem 2rem;gap:1rem;z-index:99;border-top:1px solid rgba(201,168,76,0.15)';
  } else {
    links.style.cssText = '';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  injectNav();
  injectFooter();
});

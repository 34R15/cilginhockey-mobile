/**
 * Onboarding — first-launch single-slide spotlight coach-mark.
 * Shows the real game screenshot (assets/onboard1.png) dimmed, with a bright
 * spotlight + animated arrow over the bottom-left power-up button, since that
 * is the one non-obvious mechanic. Tapping anywhere (or the button) dismisses it.
 * A localStorage gate ensures it appears only once.
 */

const STORAGE_KEY = 'ch-onboarding-seen-v1';

export class Onboarding {
  /** Has the user already completed/skipped onboarding? */
  static seen() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
  }

  static markSeen() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
  }

  /**
   * @param {function} onDone - called when the user dismisses the coach-mark
   */
  constructor(onDone) {
    this.onDone = onDone;
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'onboarding';
    root.innerHTML = `
      <div class="ob-shot"></div>
      <div class="ob-spotlight"></div>
      <div class="ob-ring"></div>
      <svg class="ob-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="5" x2="7" y2="17"/>
        <polyline points="16 17 7 17 7 8"/>
      </svg>
      <div class="ob-caption">
        <div class="ob-badge">YENİ</div>
        <h2 class="ob-title">Özel Güçler</h2>
        <p class="ob-desc">Sol alttaki <b>⚡ butona</b> dokun ve aç. Turbo, Dev Raket ve
          Dondur ile rakibini alt et!</p>
        <button type="button" class="btn btn-cta ob-cta" id="obDone">Anladım, Başla!</button>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;

    // The CTA button stops propagation so the overlay's own tap-to-dismiss
    // doesn't double-fire; both ultimately call _finish().
    root.querySelector('#obDone').addEventListener('click', (e) => {
      e.stopPropagation();
      this._finish();
    });
    // Tap anywhere else also dismisses
    root.addEventListener('click', () => this._finish());
  }

  _finish() {
    if (this._closing) return;
    this._closing = true;
    Onboarding.markSeen();
    this.root.classList.add('ob-closing');
    setTimeout(() => {
      this.root.remove();
      if (this.onDone) this.onDone();
    }, 300);
  }
}

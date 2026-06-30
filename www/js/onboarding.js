/**
 * Onboarding — first-launch slide walkthrough.
 * Slide-based intro (welcome → how to play → modes → power-ups) with swipe
 * gestures, dot indicators, a skip button, and a localStorage gate so it
 * shows only once. Builds its own DOM; matches the dark neon glass theme.
 */

const STORAGE_KEY = 'ch-onboarding-seen-v1';

const SLIDES = [
  {
    accent: 'rose',
    image: 'assets/images/cilginhokey.png',
    title: 'ÇILGIN HOKEY',
    desc: 'Hızlı, neon ve çılgın hava hokeyine hoş geldin. Hadi başlayalım!',
    // ⚡
    icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  },
  {
    accent: 'cyan',
    title: 'Parmağınla Oyna',
    desc: 'Raketini parmağınla sürükle. Diski rakibin kalesine sokarak sayı kazan.',
    icon: '<path d="M8 13V5a2 2 0 0 1 4 0v6"/><path d="M12 11V4a2 2 0 0 1 4 0v8"/><path d="M16 11.5V6a2 2 0 0 1 4 0v9a6 6 0 0 1-6 6h-2a7 7 0 0 1-5-3l-2.5-3.5a2 2 0 0 1 3-2.5L8 13"/>',
  },
  {
    accent: 'purple',
    title: 'Modları Keşfet',
    desc: 'Bota karşı oyna, hızlı eşleşmeyle rastgele rakip bul ya da arkadaşınla oda kur.',
    icon: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
  },
  {
    accent: 'green',
    title: 'Özel Güçleri Kullan',
    desc: 'Sol alttaki ⚡ butonuna dokun: Turbo, Dev Raket ve Dondur ile rakibini şaşırt.',
    icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  },
];

export class Onboarding {
  /** Has the user already completed/skipped onboarding? */
  static seen() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
  }

  static markSeen() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
  }

  /**
   * @param {function} onDone - called when the user finishes or skips
   */
  constructor(onDone) {
    this.onDone = onDone;
    this.index = 0;
    this.touchStartX = null;
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'onboarding';
    root.innerHTML = `
      <div class="ob-top">
        <button type="button" class="ob-skip" id="obSkip">Atla</button>
      </div>
      <div class="ob-body" id="obBody"></div>
      <div class="ob-bottom">
        <div class="ob-dots" id="obDots"></div>
        <button type="button" class="btn btn-cta ob-next" id="obNext"></button>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;

    this.body = root.querySelector('#obBody');
    this.dots = root.querySelector('#obDots');
    this.nextBtn = root.querySelector('#obNext');

    // Dot indicators
    this.dots.innerHTML = SLIDES.map(() => '<span class="ob-dot"></span>').join('');

    // Events
    root.querySelector('#obSkip').addEventListener('click', () => this._finish());
    this.nextBtn.addEventListener('click', () => this._next());
    root.addEventListener('touchstart', (e) => { this.touchStartX = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: true });

    this._render();
  }

  get isLast() { return this.index === SLIDES.length - 1; }

  _render() {
    const slide = SLIDES[this.index];

    const visual = slide.image
      ? `<img class="ob-img" src="${slide.image}" alt="">`
      : `<span class="ob-icon ob-${slide.accent}">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">${slide.icon}</svg>
         </span>`;

    this.body.innerHTML = `
      <div class="ob-slide" key="${this.index}">
        ${visual}
        <h2 class="ob-title">${slide.title}</h2>
        <p class="ob-desc">${slide.desc}</p>
      </div>
    `;

    // Restart the pop animation each slide change
    const slideEl = this.body.querySelector('.ob-slide');
    void slideEl.offsetWidth;
    slideEl.classList.add('ob-pop');

    // Dots
    this.dots.querySelectorAll('.ob-dot').forEach((d, i) => {
      d.classList.toggle('active', i === this.index);
    });

    // Button label + skip visibility
    this.nextBtn.textContent = this.isLast ? 'Başla' : 'İleri';
    this.root.querySelector('#obSkip').style.visibility = this.isLast ? 'hidden' : 'visible';
  }

  _next() {
    if (this.isLast) this._finish();
    else { this.index++; this._render(); }
  }

  _prev() {
    if (this.index > 0) { this.index--; this._render(); }
  }

  _onTouchEnd(e) {
    if (this.touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    if (dx < -50) this._next();        // swipe left → forward
    else if (dx > 50) this._prev();    // swipe right → back
    this.touchStartX = null;
  }

  _finish() {
    Onboarding.markSeen();
    this.root.classList.add('ob-closing');
    setTimeout(() => {
      this.root.remove();
      if (this.onDone) this.onDone();
    }, 300);
  }
}

import { GRACE_SEC } from './config.js';
import { Renderer } from './renderer.js';

/**
 * UI — manages all in-game overlays and animated DOM elements.
 * Receives callbacks; never touches network or game state directly.
 *
 * Overlays managed:
 *   1. Reconnect / pause overlay  (#reconnectOverlay)
 *   2. Quick-match searching card (#searchingOverlay)
 *   3. Game-over dialog           (#gameOverDialog)
 *   4. Goal animation             (#goalAnimation)
 *   5. Start countdown            (#startCountdown)
 */
export class UI {

  // ─── 1. Reconnect overlay ──────────────────────────────────────────────────

  showReconnect(message, secondLine) {
    let el = document.getElementById('reconnectOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'reconnectOverlay';
      el.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,0.82);color:#fff;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;text-align:center;z-index:1500;' +
        "font-family:'Montserrat','Arial',sans-serif;padding:24px;gap:14px;";
      document.body.appendChild(el);
    }
    const lines = message.split('\n');
    let html = `<div style="font-size:20px;opacity:0.9;line-height:1.5;">${lines.join('<br>')}</div>`;
    if (secondLine !== undefined) {
      html += `<div style="font-size:52px;font-weight:bold;color:#ff9900;` +
              `text-shadow:0 0 20px #ff9900;">${secondLine}</div>`;
    }
    el.innerHTML = html;
    el.style.display = 'flex';
  }

  hideReconnect() {
    const el = document.getElementById('reconnectOverlay');
    if (el) el.style.display = 'none';
  }

  /**
   * Shows a ticking countdown overlay.
   * @returns {function} cancel function — call to stop the timer
   */
  startCountdownOverlay(titleLine, onExpire) {
    let remaining = GRACE_SEC;
    this.showReconnect(titleLine, remaining);
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        if (onExpire) onExpire();
      } else {
        this.showReconnect(titleLine, remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }

  // ─── 2. Searching overlay ──────────────────────────────────────────────────

  showSearching(onCancel) {
    let el = document.getElementById('searchingOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'searchingOverlay';
      el.style.cssText =
        'position:fixed;inset:0;z-index:1600;display:grid;place-items:center;' +
        'background:rgba(8,8,22,0.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
        "font-family:'Montserrat','Arial',sans-serif;padding:24px;box-sizing:border-box;";
      el.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:24px;' +
        'padding:34px 30px;border-radius:26px;background:rgba(255,255,255,0.06);' +
        'border:1px solid rgba(255,255,255,0.14);box-shadow:0 24px 60px rgba(0,0,0,0.55);">' +
          '<div style="font-family:\'Orbitron\',sans-serif;font-size:19px;font-weight:700;' +
          'letter-spacing:0.5px;color:#eef1f8;">Rakip Aranıyor</div>' +
          '<div style="width:54px;height:54px;border:4px solid rgba(255,255,255,0.18);' +
          'border-top-color:#22d3ee;border-radius:50%;animation:qmspin 0.9s linear infinite;"></div>' +
          '<button id="cancelSearchBtn" style="padding:13px 34px;font-size:16px;border:none;' +
          'border-radius:14px;background:linear-gradient(135deg,#f43f5e 0%,#7c3aed 100%);' +
          'color:#fff;font-weight:700;cursor:pointer;box-shadow:0 8px 22px rgba(124,58,237,0.4);">' +
          'İptal</button>' +
        '</div>';
      document.body.appendChild(el);

      if (!document.getElementById('qmSpinStyle')) {
        const st = document.createElement('style');
        st.id = 'qmSpinStyle';
        st.textContent = '@keyframes qmspin{to{transform:rotate(360deg)}}';
        document.head.appendChild(st);
      }
    }
    // Re-wire cancel button each time (onCancel may differ)
    const btn = el.querySelector('#cancelSearchBtn');
    if (btn) {
      btn.onclick = onCancel;
    }
    el.style.display = 'grid';
  }

  hideSearching() {
    const el = document.getElementById('searchingOverlay');
    if (el) el.style.display = 'none';
  }

  // ─── 3. Game-over dialog ───────────────────────────────────────────────────

  showGameOver(message, onNewGame) {
    // Remove any existing dialog first
    const existing = document.getElementById('gameOverDialog');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'gameOverDialog';
    wrap.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.85);display:flex;align-items:center;' +
      'justify-content:center;z-index:2000;';

    const card = document.createElement('div');
    card.style.cssText =
      'background:rgba(0,0,0,0.95);padding:32px 20px 28px;border-radius:18px;' +
      'text-align:center;width:90vw;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.25);';

    const title = document.createElement('h2');
    title.textContent = message;
    title.style.cssText =
      "color:#fff;font-size:24px;margin:0 0 20px;font-family:'Montserrat','Arial',sans-serif;";

    const btn = document.createElement('button');
    btn.textContent = 'Yeni Oyun';
    btn.style.cssText =
      'padding:18px 0;width:100%;font-size:22px;border-radius:12px;border:none;' +
      'background:linear-gradient(90deg,#43e97b 0%,#38f9d7 100%);color:#fff;' +
      'cursor:pointer;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.12);' +
      'transition:background 0.2s,box-shadow 0.2s;';
    btn.addEventListener('mousedown', () => {
      btn.style.background = 'linear-gradient(90deg,#11998e 0%,#38ef7d 100%)';
    });
    btn.addEventListener('click', () => {
      wrap.remove();
      if (onNewGame) onNewGame();
    });

    card.appendChild(title);
    card.appendChild(btn);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
  }

  removeGameOver() {
    const el = document.getElementById('gameOverDialog');
    if (el) el.remove();
  }

  // ─── 4. Goal animation ─────────────────────────────────────────────────────

  showGoalAnimation() {
    const el = document.getElementById('goalAnimation');
    if (!el) return;
    el.style.color = Renderer.randomGoalColor();
    el.style.display = 'block';
    el.classList.remove('show');
    void el.offsetWidth; // force reflow
    el.classList.add('show');
    try { if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]); } catch {}
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.style.display = 'none'; }, 500);
    }, 1500);
  }

  // ─── 5. Start countdown ────────────────────────────────────────────────────

  showStartCountdown(onComplete) {
    const el = document.getElementById('startCountdown');
    const steps = [
      ['Hazır ol!', '#ffffff', 'countdownPop 0.6s ease-out forwards',  '3.2rem'],
      ['3',         '#ff4444', 'countdownPop 0.5s ease-out forwards',  '7rem'],
      ['2',         '#ffaa00', 'countdownPop 0.5s ease-out forwards',  '7rem'],
      ['1',         '#44ff44', 'countdownPop 0.5s ease-out forwards',  '7rem'],
      ['BAŞLA!',    '#39ff14', 'countdownGo  0.55s ease-out forwards', '5rem'],
    ];
    let i = 0;

    const show = (idx) => {
      const [text, color, anim, size] = steps[idx];
      el.style.display   = 'flex';
      el.style.opacity   = '1';
      el.style.color     = color;
      el.style.fontSize  = size;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = anim;
      el.textContent     = text;
    };

    const next = () => {
      i++;
      if (i >= steps.length) return;
      show(i);
      if (i < steps.length - 1) {
        setTimeout(next, 900);
      } else {
        setTimeout(() => {
          el.style.opacity = '0';
          setTimeout(() => {
            el.style.display   = 'none';
            el.style.opacity   = '1';
            el.style.animation = 'none';
            el.textContent     = '';
            if (onComplete) onComplete();
          }, 350);
        }, 600);
      }
    };

    show(0);
    setTimeout(next, 1100);
  }
}

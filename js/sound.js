/**
 * SoundManager — loads and plays game sound effects.
 * Handles iOS AudioContext unlock via the first canvas interaction.
 * Has no dependency on state or network.
 */
import { settings } from './settings.js';

export class SoundManager {
  constructor() {
    this._goal = null;
    this._hit  = null;
    this._ctx  = null;   // Web Audio context for synthesised sfx
    this._loaded       = false;
    this._initialized  = false;
  }

  /**
   * Call this from a canvas touchstart/click handler.
   * iOS requires a user gesture before audio can play.
   * Ignores events that originate from menu/button elements.
   */
  init(event) {
    if (event && event.target) {
      const t = event.target;
      if (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' ||
        t.closest('#menu') || t.closest('#mainMenu') ||
        t.closest('#waitingRoom') || t.closest('#scoreLimitPopup')
      ) return;
    }

    if (this._initialized) return;
    this._initialized = true;

    this._goal = new Audio('assets/sounds/gol.mp3');
    this._hit  = new Audio('assets/sounds/hit.mp3');
    this._goal.volume = 0.7;
    this._hit.volume  = 0.5;
    this._goal.load();
    this._hit.load();

    // Web Audio context (used for synthesised power-up sound)
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { /* ignore */ }

    // Silent test-play to unlock iOS audio pipeline
    Promise.all([
      this._goal.play().then(() => { this._goal.pause(); this._goal.currentTime = 0; }).catch(() => {}),
      this._hit.play().then(()  => { this._hit.pause();  this._hit.currentTime  = 0; }).catch(() => {}),
    ]).then(() => {
      this._loaded = true;
    }).catch(() => {
      this._initialized = false; // allow retry
    });
  }

  async playHit() {
    await this._play(this._hit);
  }

  async playGoal() {
    await this._play(this._goal);
  }

  /**
   * Synthesised power-up activation sound: short ascending whoosh.
   * Uses Web Audio API — no extra asset file needed.
   */
  playPower() {
    const ctx = this._ctx;
    if (!ctx || !settings.soundEnabled) return;
    // Resume context if suspended (iOS requires user-gesture unlock)
    const run = () => {
      const now = ctx.currentTime;

      // Sweep oscillator: low → high pitch
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.38, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      // Subtle high-freq shimmer on top
      const osc2  = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1200, now + 0.06);
      osc2.frequency.exponentialRampToValueAtTime(2400, now + 0.2);
      gain2.gain.setValueAtTime(0.12, now + 0.06);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.start(now);  osc.stop(now + 0.25);
      osc2.start(now + 0.06); osc2.stop(now + 0.25);
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(run).catch(() => {});
    } else {
      run();
    }
  }

  async _play(sound) {
    if (!sound || !this._loaded || !settings.soundEnabled) return;
    try {
      sound.currentTime = 0;
      await sound.play();
    } catch {
      this._initialized = false;
    }
  }
}

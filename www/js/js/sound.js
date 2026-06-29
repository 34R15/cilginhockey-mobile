/**
 * SoundManager — loads and plays game sound effects.
 * Handles iOS AudioContext unlock via the first canvas interaction.
 * Has no dependency on state or network.
 */
export class SoundManager {
  constructor() {
    this._goal = null;
    this._hit  = null;
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

  async _play(sound) {
    if (!sound || !this._loaded) return;
    try {
      sound.currentTime = 0;
      await sound.play();
    } catch {
      this._initialized = false;
    }
  }
}

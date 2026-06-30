/**
 * settings.js — persisted user preferences via localStorage.
 * All other modules import this to check sound / vibration flags.
 */

const K = { sound: 'ch-sound-v1', vibration: 'ch-vibration-v1' };

function _get(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch { return def; }
}

function _set(key, val) {
  try { localStorage.setItem(key, val ? '1' : '0'); } catch {}
}

export const settings = {
  get soundEnabled()      { return _get(K.sound,     true); },
  set soundEnabled(v)     { _set(K.sound,     v); },
  get vibrationEnabled()  { return _get(K.vibration, true); },
  set vibrationEnabled(v) { _set(K.vibration, v); },
};

/**
 * haptics.js — thin wrapper around Capacitor's Haptics plugin.
 * Works in Capacitor (iOS Taptic Engine) and falls back silently
 * in plain browser / Android web where the bridge isn't available.
 *
 * ImpactStyle values: 'Heavy' | 'Medium' | 'Light'
 * NotificationType values: 'Success' | 'Warning' | 'Error'
 */

import { settings } from './settings.js';

function _plugin() {
  return window.Capacitor?.Plugins?.Haptics ?? null;
}

export const haptic = {
  /** Short physical tap. style: 'Heavy' | 'Medium' | 'Light' */
  async impact(style = 'Medium') {
    if (!settings.vibrationEnabled) return;
    try { await _plugin()?.impact({ style }); } catch {}
  },

  /** Pattern feedback. type: 'Success' | 'Warning' | 'Error' */
  async notification(type = 'Success') {
    if (!settings.vibrationEnabled) return;
    try { await _plugin()?.notification({ type }); } catch {}
  },
};

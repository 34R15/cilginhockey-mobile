export const SERVER_URL = (
  window.location.protocol === 'file:' ||
  window.location.protocol === 'capacitor:'
) ? 'https://b4ris.alwaysdata.net' : window.location.origin;

export const GOAL_WIDTH_RATIO = 0.66;
export const GRACE_SEC        = 20;   // must match server REJOIN_GRACE_MS / 1000
export const LERP_PUCK        = 0.45;
export const LERP_OPP         = 0.30;

export const SOCKET_OPTS = {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 60000,
};

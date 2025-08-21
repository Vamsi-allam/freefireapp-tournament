// Auth guards: auto-logout on JWT expiry and on 401/403 responses
// Minimal, framework-agnostic helpers wired from main.jsx

let expiryTimerId = null;

function safeAtob(input) {
  try {
    // Handle base64url
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
    return atob(b64 + pad);
  } catch {
    return null;
  }
}

export function parseJwt(token) {
  if (!token || typeof token !== 'string' || token.split('.').length < 2) return null;
  const base64Url = token.split('.')[1];
  const json = safeAtob(base64Url);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getJwtExpiryMs(token) {
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return null;
  return payload.exp * 1000; // exp is seconds since epoch
}

export function isJwtExpired(token, skewMs = 5000) {
  const expMs = getJwtExpiryMs(token);
  if (!expMs) return false; // if unknown, don't force logout here
  return Date.now() >= expMs - skewMs;
}

function clearExistingTimer() {
  if (expiryTimerId) {
    clearTimeout(expiryTimerId);
    expiryTimerId = null;
  }
}

export function scheduleLogoutAtExpiry(store, token) {
  clearExistingTimer();
  const expMs = getJwtExpiryMs(token);
  if (!expMs) return; // no exp -> skip timer
  const now = Date.now();
  const delay = Math.max(0, expMs - now);
  if (delay === 0) {
    try {
      const { clearUser } = require('../redux/userSlice');
      store.dispatch(clearUser());
    } catch {}
    return;
  }
  expiryTimerId = setTimeout(() => {
    try {
      const { clearUser } = require('../redux/userSlice');
      store.dispatch(clearUser());
    } catch {}
  }, delay);
}

export function installFetch401Interceptor(store) {
  if (typeof window === 'undefined') return;
  if (window.__fetch401Installed) return;
  window.__fetch401Installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      // Prefix relative API calls with configured backend base URL in prod
      const API_BASE = (import.meta?.env?.VITE_API_BASE_URL || '').trim();
      if (API_BASE) {
        let input = args[0];
        let init = args[1];
        let url = (typeof input === 'string') ? input : (input && input.url);
        if (typeof url === 'string' && (url.startsWith('/api') || url.startsWith('/auth'))) {
          const prefixed = API_BASE + url;
          // Rebuild request to ensure new URL is used
          if (typeof input === 'string') {
            input = prefixed;
          } else {
            input = new Request(prefixed, input);
          }
          args = [input, init];
        }
      }
    } catch {
      // ignore prefixing errors and fall back to original args
    }

    const res = await orig(...args);
    if (res && (res.status === 401 || res.status === 403)) {
      try {
        const { clearUser } = require('../redux/userSlice');
        store.dispatch(clearUser());
      } catch {}
    }
    return res;
  };
}

export function initAuthGuards(store) {
  // On boot: schedule timer if we have a token
  try {
  const token = sessionStorage.getItem('token');
    if (token) {
      if (isJwtExpired(token)) {
        const { clearUser } = require('../redux/userSlice');
        store.dispatch(clearUser());
      } else {
        scheduleLogoutAtExpiry(store, token);
      }
    }
  } catch {}

  // Update timer on store token changes
  let lastToken = null;
  try {
    const state = store.getState();
    lastToken = state?.user?.token || null;
  } catch {}

  store.subscribe(() => {
    try {
      const current = store.getState()?.user?.token || null;
      if (current !== lastToken) {
        lastToken = current;
        clearExistingTimer();
        if (current) {
          if (isJwtExpired(current)) {
            const { clearUser } = require('../redux/userSlice');
            store.dispatch(clearUser());
          } else {
            scheduleLogoutAtExpiry(store, current);
          }
        }
      }
    } catch {}
  });

  // Intercept 401/403 everywhere
  installFetch401Interceptor(store);
}

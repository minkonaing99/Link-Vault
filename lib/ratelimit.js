const { TRUSTED_PROXY } = require('./config');

const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;  // 15 minutes
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Map<ip, { count, firstAttempt, lockedUntil }>
const loginAttempts = new Map();

function getClientIp(req) {
  if (TRUSTED_PROXY) {
    // Only trust X-Forwarded-For when a reverse proxy is guaranteed to set it
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  // Still locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  // Window expired — clean slate
  if (now - record.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.ceil((record.firstAttempt + LOGIN_WINDOW_MS - now) / 1000) };
  }

  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now - record.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now, lockedUntil: null });
    return;
  }

  record.count += 1;
  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    record.lockedUntil = now + LOGIN_LOCKOUT_MS;
  }
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

module.exports = { getClientIp, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts };

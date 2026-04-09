const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { URL } = require('url');
const { collections, connectDb } = require('./db');
const {
  JWT_SECRET, AUTH_COOKIE_NAME, AUTH_SESSION_TTL_DAYS,
  ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS,
} = require('./config');
const { makeSessionToken, isApiPath, publicUser } = require('./utils');
const { sendJson } = require('./http');

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(
    raw
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function makeCookie(token, expiresAt) {
  return [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join('; ');
}

function clearCookie() {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function signJwt(payload, expiresInSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const content = `${encodedHeader}.${encodedBody}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(content).digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${content}.${signature}`;
}

function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [encodedHeader, encodedBody, signature] = parts;
  const content = `${encodedHeader}.${encodedBody}`;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(content).digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) throw new Error('Invalid token signature');
  const payload = JSON.parse(base64UrlDecode(encodedBody));
  if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error('Token expired');
  }
  return payload;
}

function extractBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim() || null;
}

async function authenticateUser(username, password) {
  await connectDb();
  const user = await collections.users.findOne({ username });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return null;
  return user;
}

async function createSession(res, user) {
  const token = makeSessionToken();
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await collections.sessions.insertOne({
    token,
    userId: user.id,
    username: user.username,
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  res.setHeader('Set-Cookie', makeCookie(token, expiresAt));
}

async function destroySession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE_NAME];
  if (token) await collections.sessions.deleteOne({ token });
  if (res) res.setHeader('Set-Cookie', clearCookie());
}

async function getCookieSessionUser(req) {
  await connectDb();
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) return null;
  const session = await collections.sessions.findOne({ token });
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await collections.sessions.deleteOne({ token });
    return null;
  }
  const user = await collections.users.findOne(
    { id: session.userId },
    { projection: { _id: 0, passwordHash: 0 } }
  );
  return user || null;
}

async function getBearerUser(req) {
  await connectDb();
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const payload = verifyJwt(token);
    const user = await collections.users.findOne(
      { id: payload.sub, username: payload.username },
      { projection: { _id: 0, passwordHash: 0 } }
    );
    return user || null;
  } catch {
    return null;
  }
}

async function getAuthenticatedUser(req) {
  const bearerUser = await getBearerUser(req);
  if (bearerUser) return { user: bearerUser, method: 'bearer' };
  const sessionUser = await getCookieSessionUser(req);
  if (sessionUser) return { user: sessionUser, method: 'cookie' };
  return null;
}

async function requireAuth(req, res) {
  const auth = await getAuthenticatedUser(req);
  if (auth) return auth;
  if (isApiPath(new URL(req.url, `http://${req.headers.host}`).pathname)) {
    sendJson(res, 401, { error: 'Authentication required' }, { 'Set-Cookie': clearCookie() });
  } else {
    res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store', 'Set-Cookie': clearCookie() });
    res.end();
  }
  return null;
}

function createAccessToken(user) {
  return signJwt({ sub: user.id, username: user.username, type: 'access' }, ACCESS_TOKEN_TTL_MINUTES * 60);
}

function refreshTokenExpiryDate() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function createRefreshToken(user) {
  await connectDb();
  const token = makeSessionToken();
  const expiresAt = refreshTokenExpiryDate();
  await collections.refreshTokens.insertOne({
    token,
    userId: user.id,
    username: user.username,
    createdAt: new Date().toISOString(),
    expiresAt,
    revokedAt: null,
  });
  return { refreshToken: token, expiresAt: expiresAt.toISOString() };
}

async function issueTokenPair(user) {
  const accessToken = createAccessToken(user);
  const refresh = await createRefreshToken(user);
  return {
    tokenType: 'Bearer',
    accessToken,
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_MINUTES * 60,
    refreshToken: refresh.refreshToken,
    refreshTokenExpiresAt: refresh.expiresAt,
    user: publicUser(user),
  };
}

async function revokeRefreshToken(token) {
  await connectDb();
  if (!token) return false;
  const timestamp = new Date().toISOString();
  const result = await collections.refreshTokens.updateOne(
    { token, revokedAt: null },
    { $set: { revokedAt: timestamp, updatedAt: timestamp } }
  );
  return Boolean(result.modifiedCount);
}

async function findValidRefreshToken(token) {
  await connectDb();
  if (!token) return null;
  const refreshToken = await collections.refreshTokens.findOne({ token }, { projection: { _id: 0 } });
  if (!refreshToken) return null;
  if (refreshToken.revokedAt) return null;
  if (new Date(refreshToken.expiresAt).getTime() <= Date.now()) {
    await collections.refreshTokens.deleteOne({ token });
    return null;
  }
  return refreshToken;
}

module.exports = {
  parseCookies, makeCookie, clearCookie,
  authenticateUser, createSession, destroySession,
  getAuthenticatedUser, requireAuth,
  issueTokenPair, revokeRefreshToken, findValidRefreshToken,
};

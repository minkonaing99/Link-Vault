require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const PORT = Number(process.env.PORT || 3080);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'linknest';
const COLLECTION_NAME = 'links';
const USERS_COLLECTION = 'users';
const SESSIONS_COLLECTION = 'sessions';
const REFRESH_TOKENS_COLLECTION = 'refresh_tokens';
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'linknest_session';
const AUTH_SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);
const JWT_TTL_DAYS = Number(process.env.JWT_TTL_DAYS || 30);
const ACCESS_TOKEN_TTL_MINUTES = Number(process.env.ACCESS_TOKEN_TTL_MINUTES || 15);
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || JWT_TTL_DAYS || 30);
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const ADMIN_USERNAME = String(process.env.LINKNEST_ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = String(process.env.LINKNEST_ADMIN_PASSWORD || '').trim();
const PROTECTED_PAGES = new Set(['/browse.html', '/editor.html', '/archive.html', '/']);
const PUBLIC_PAGES = new Set(['/login.html', '/offline.html']);
const ENTRY_TITLE_MAX_LENGTH = 300;
const ENTRY_TAG_MAX_LENGTH = 50;
const ENTRY_TAGS_MAX_COUNT = 20;
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI. Put it in .env or the environment before starting Link Nest.');
}

if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET. Put it in .env before starting Link Nest.');
}

let mongoClient;
let db;
let linksCollection;
let usersCollection;
let sessionsCollection;
let refreshTokensCollection;

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...extraHeaders });
  res.end(text);
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

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

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
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

function normalizeUrl(input) {
  const url = new URL(input);
  const noisyParams = new Set([
    'fbclid', 'gclid', 'igshid', 'mc_eid', 'mkt_tok', 'ref', 'ref_src',
    'state', 'code', 'code_challenge', 'code_challenge_method', 'scope',
    'response_type', 'client_id', 'redirect_uri', 'returnurl', 'return_url',
    'ui_locales', 'requestsource', 'allowazureb2caccountcreation', 'isiol',
    'session_state', 'prompt', 'nonce'
  ]);

  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (noisyParams.has(normalizedKey) || /^utm_/i.test(key)) {
      url.searchParams.delete(key);
    }
  }

  const authLikePath = /\/(account\/login|connect\/authorize|connect\/authorize\/callback|signin|login|auth)\/?$/i.test(url.pathname);
  const authLikeHost = /(identity|auth|login)/i.test(url.hostname);
  if (authLikePath && authLikeHost) {
    url.search = '';
  }

  url.hash = '';
  return url.toString();
}

function deriveHost(urlString) {
  try {
    return new URL(urlString).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function makeId() {
  return crypto.randomUUID();
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function normalizeStatus(value) {
  const allowed = new Set(['unread', 'saved', 'useful', 'archived']);
  return allowed.has(value) ? value : 'saved';
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return [...new Set(list.map(tag => String(tag).trim()).filter(Boolean))];
}

function validationError(message, details = {}) {
  const error = new Error(message);
  error.statusCode = 400;
  error.payload = { error: message, ...details };
  return error;
}

function ensurePlainObject(value, fallbackMessage = 'Request body must be a JSON object') {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw validationError(fallbackMessage);
  }
  return value;
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parsePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseIsoDateTime(value, fieldName) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw validationError(`Invalid ${fieldName} value`);
  }
  return parsed.toISOString();
}

function buildSort(sort, order) {
  const direction = String(order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  if (sort === 'title') return { pinned: -1, title: direction, updatedAt: -1, id: 1 };
  if (sort === 'date') return { pinned: -1, date: direction, updatedAt: -1, id: 1 };
  if (sort === 'createdAt') return { pinned: -1, createdAt: direction, updatedAt: -1, id: 1 };
  return { pinned: -1, updatedAt: direction, createdAt: -1, id: 1 };
}

function parseLinkListQuery(searchParams) {
  const page = parsePositiveInt(searchParams.get('page'), 1, 1);
  const limit = parsePositiveInt(searchParams.get('limit'), LIST_LIMIT_DEFAULT, 1, LIST_LIMIT_MAX);
  const includeDeleted = parseBooleanFlag(searchParams.get('includeDeleted'), false);
  const status = String(searchParams.get('status') || '').trim();
  const tag = String(searchParams.get('tag') || '').trim();
  const q = String(searchParams.get('q') || searchParams.get('search') || '').trim();
  const sort = String(searchParams.get('sort') || 'updatedAt').trim();
  const order = String(searchParams.get('order') || 'desc').trim();
  const updatedAfter = parseIsoDateTime(searchParams.get('updatedAfter'), 'updatedAfter');
  const filter = {};

  if (!includeDeleted) {
    filter.deletedAt = null;
  }

  if (status) {
    if (status === 'deleted') {
      filter.deletedAt = { $ne: null };
    } else {
      filter.status = normalizeStatus(status);
    }
  }

  if (tag) {
    filter.tags = { $regex: new RegExp(`^${escapeRegex(tag)}$`, 'i') };
  }

  if (updatedAfter) {
    filter.updatedAt = { $gt: updatedAfter };
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { title: regex },
      { url: regex },
      { host: regex },
      { tags: regex },
      { date: regex },
    ];
  }

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    filter,
    sort: buildSort(sort, order),
    query: q,
    includeDeleted,
    status,
    tag,
    sortField: sort,
    sortOrder: String(order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
    updatedAfter,
  };
}

function sanitizeEntry(input = {}, options = {}) {
  const body = ensurePlainObject(input, 'Link payload must be a JSON object');
  const rawUrl = String(body.url || '').trim();
  if (!rawUrl) throw validationError('URL is required');

  let cleanedUrl;
  try {
    cleanedUrl = normalizeUrl(rawUrl);
  } catch {
    throw validationError('URL must be a valid absolute URL');
  }

  const date = String(body.date || new Date().toISOString().slice(0, 10)).trim();
  if (!isValidDateString(date)) {
    throw validationError('date must use YYYY-MM-DD format');
  }

  const title = String(body.title || cleanedUrl).trim() || cleanedUrl;
  if (title.length > ENTRY_TITLE_MAX_LENGTH) {
    throw validationError(`title must be ${ENTRY_TITLE_MAX_LENGTH} characters or fewer`);
  }

  const tags = normalizeTags(body.tags);
  if (tags.length > ENTRY_TAGS_MAX_COUNT) {
    throw validationError(`tags must contain ${ENTRY_TAGS_MAX_COUNT} items or fewer`);
  }
  if (tags.some(tag => tag.length > ENTRY_TAG_MAX_LENGTH)) {
    throw validationError(`each tag must be ${ENTRY_TAG_MAX_LENGTH} characters or fewer`);
  }

  const now = new Date().toISOString();
  const createdAt = options.existing?.createdAt || body.createdAt || now;
  const deletedAt = body.deletedAt == null || body.deletedAt === '' ? null : parseIsoDateTime(body.deletedAt, 'deletedAt');

  return {
    id: body.id ? String(body.id) : makeId(),
    date,
    title,
    url: cleanedUrl,
    host: deriveHost(cleanedUrl),
    tags,
    status: normalizeStatus(String(body.status || 'saved').trim()),
    pinned: Boolean(body.pinned),
    createdAt: parseIsoDateTime(createdAt, 'createdAt') || now,
    updatedAt: now,
    deletedAt,
  };
}

function normalizeStoredEntry(item = {}) {
  return {
    id: item.id || makeId(),
    date: item.date || '',
    title: item.title || item.url || 'Untitled',
    url: item.url,
    host: item.host || deriveHost(item.url || ''),
    tags: normalizeTags(item.tags),
    status: normalizeStatus(item.status || 'saved'),
    pinned: Boolean(item.pinned),
    createdAt: item.createdAt || item.updatedAt || null,
    updatedAt: item.updatedAt || null,
    deletedAt: item.deletedAt || null,
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function fetchTitleForUrl(rawUrl) {
  const cleanedUrl = normalizeUrl(rawUrl);
  const host = deriveHost(cleanedUrl);

  if (/(youtube\.com|youtu\.be)$/i.test(host)) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanedUrl)}&format=json`;
      const oembedRes = await fetch(oembedUrl, { headers: { 'User-Agent': 'LinkNest/0.1 (+local)' } });
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        if (oembed?.title) return { title: String(oembed.title).trim(), url: cleanedUrl, host };
      }
    } catch {
    }
  }

  const response = await fetch(cleanedUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'LinkNest/0.1 (+local)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  return { title: title || cleanedUrl, url: cleanedUrl, host };
}

async function connectDb() {
  if (linksCollection && usersCollection && sessionsCollection && refreshTokensCollection) return;
  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db(DB_NAME);
  linksCollection = db.collection(COLLECTION_NAME);
  usersCollection = db.collection(USERS_COLLECTION);
  sessionsCollection = db.collection(SESSIONS_COLLECTION);
  refreshTokensCollection = db.collection(REFRESH_TOKENS_COLLECTION);

  try {
    const indexes = await linksCollection.indexes();
    const legacyNotesTextIndex = indexes.find(index =>
      index.name === 'title_text_notes_text_host_text_tags_text'
    );
    if (legacyNotesTextIndex) {
      await linksCollection.dropIndex(legacyNotesTextIndex.name);
    }
  } catch {
  }

  await Promise.all([
    linksCollection.createIndex({ id: 1 }, { unique: true }),
    linksCollection.createIndex({ url: 1 }, { unique: true }),
    linksCollection.createIndex({ updatedAt: -1 }),
    linksCollection.createIndex({ createdAt: -1 }),
    linksCollection.createIndex({ date: -1 }),
    linksCollection.createIndex({ deletedAt: 1 }),
    linksCollection.createIndex({ status: 1, updatedAt: -1 }),
    linksCollection.createIndex({ tags: 1, updatedAt: -1 }),
    linksCollection.createIndex({ title: 'text', host: 'text', tags: 'text' }),
    usersCollection.createIndex({ username: 1 }, { unique: true }),
    sessionsCollection.createIndex({ token: 1 }, { unique: true }),
    sessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    refreshTokensCollection.createIndex({ token: 1 }, { unique: true }),
    refreshTokensCollection.createIndex({ userId: 1, revokedAt: 1 }),
    refreshTokensCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

async function ensureAdminUser() {
  await connectDb();
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn('No usable initial admin credentials found. Set LINKNEST_ADMIN_USERNAME and LINKNEST_ADMIN_PASSWORD in .env.');
    return;
  }
  const existing = await usersCollection.findOne({ username: ADMIN_USERNAME });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const timestamp = new Date().toISOString();

  if (!existing) {
    await usersCollection.insertOne({ id: makeId(), username: ADMIN_USERNAME, passwordHash, createdAt: timestamp, updatedAt: timestamp });
    console.log(`Created Link Nest admin user: ${ADMIN_USERNAME}`);
    return;
  }

  await usersCollection.updateOne({ username: ADMIN_USERNAME }, {
    $set: { passwordHash, updatedAt: timestamp },
    $setOnInsert: { id: makeId(), createdAt: timestamp },
  }, { upsert: true });
  console.log(`Synced Link Nest admin credentials for: ${ADMIN_USERNAME}`);
}

async function authenticateUser(username, password) {
  await connectDb();
  const user = await usersCollection.findOne({ username });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return null;
  return user;
}

async function createSession(res, user) {
  const token = makeSessionToken();
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await sessionsCollection.insertOne({ token, userId: user.id, username: user.username, createdAt: new Date().toISOString(), expiresAt });
  res.setHeader('Set-Cookie', makeCookie(token, expiresAt));
}

async function destroySession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE_NAME];
  if (token) await sessionsCollection.deleteOne({ token });
  if (res) res.setHeader('Set-Cookie', clearCookie());
}

async function getCookieSessionUser(req) {
  await connectDb();
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) return null;
  const session = await sessionsCollection.findOne({ token });
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await sessionsCollection.deleteOne({ token });
    return null;
  }
  const user = await usersCollection.findOne({ id: session.userId }, { projection: { _id: 0, passwordHash: 0 } });
  return user || null;
}

async function getBearerUser(req) {
  await connectDb();
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const payload = verifyJwt(token);
    const user = await usersCollection.findOne({ id: payload.sub, username: payload.username }, { projection: { _id: 0, passwordHash: 0 } });
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
  await refreshTokensCollection.insertOne({
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
  const result = await refreshTokensCollection.updateOne(
    { token, revokedAt: null },
    { $set: { revokedAt: timestamp, updatedAt: timestamp } }
  );
  return Boolean(result.modifiedCount);
}

async function findValidRefreshToken(token) {
  await connectDb();
  if (!token) return null;
  const refreshToken = await refreshTokensCollection.findOne({ token }, { projection: { _id: 0 } });
  if (!refreshToken) return null;
  if (refreshToken.revokedAt) return null;
  if (new Date(refreshToken.expiresAt).getTime() <= Date.now()) {
    await refreshTokensCollection.deleteOne({ token });
    return null;
  }
  return refreshToken;
}

async function readLinks(queryOptions = {}) {
  const params = {
    filter: {},
    sort: buildSort('updatedAt', 'desc'),
    limit: LIST_LIMIT_DEFAULT,
    skip: 0,
    page: 1,
    ...queryOptions,
  };

  const [docs, total] = await Promise.all([
    linksCollection.find(params.filter, { projection: { _id: 0 } }).sort(params.sort).skip(params.skip).limit(params.limit).toArray(),
    linksCollection.countDocuments(params.filter),
  ]);

  return {
    links: docs.map(normalizeStoredEntry),
    total,
    page: params.page,
    limit: params.limit,
    pages: total ? Math.ceil(total / params.limit) : 0,
  };
}

async function readAllLinksForExport() {
  const docs = await linksCollection.find({}, { projection: { _id: 0 } }).sort(buildSort('updatedAt', 'desc')).toArray();
  return docs.map(normalizeStoredEntry);
}

async function createLink(input) {
  const entry = sanitizeEntry(input);
  const existing = await linksCollection.findOne({ url: entry.url }, { projection: { _id: 0, url: 1, deletedAt: 1 } });
  if (existing) {
    const error = new Error('This link already exists');
    error.statusCode = 409;
    error.payload = { error: existing.deletedAt ? 'This link already exists but is deleted' : 'This link already exists', url: entry.url };
    throw error;
  }
  await linksCollection.insertOne(entry);
  return normalizeStoredEntry(entry);
}

async function importLinks(items) {
  const existingDocs = await linksCollection.find({}, { projection: { _id: 0, url: 1 } }).toArray();
  const existingUrls = new Set(existingDocs.map(item => item.url));
  const added = [];
  for (const raw of items) {
    try {
      const entry = sanitizeEntry(raw);
      if (existingUrls.has(entry.url)) continue;
      await linksCollection.insertOne(entry);
      existingUrls.add(entry.url);
      added.push(entry);
    } catch {
    }
  }
  return { imported: added.length, total: await linksCollection.countDocuments({ deletedAt: null }) };
}

async function updateLink(id, body) {
  const current = await linksCollection.findOne({ id }, { projection: { _id: 0 } });
  if (!current) {
    const error = new Error('Link not found');
    error.statusCode = 404;
    error.payload = { error: 'Link not found' };
    throw error;
  }
  const entry = sanitizeEntry({ ...current, ...body, id }, { existing: current });
  const duplicate = await linksCollection.findOne({ url: entry.url, id: { $ne: id } }, { projection: { _id: 0, id: 1 } });
  if (duplicate) {
    const error = new Error('Another link already uses this URL');
    error.statusCode = 409;
    error.payload = { error: 'Another link already uses this URL' };
    throw error;
  }
  await linksCollection.updateOne({ id }, { $set: entry });
  return normalizeStoredEntry(entry);
}

async function deleteLink(id, options = {}) {
  const current = await linksCollection.findOne({ id }, { projection: { _id: 0 } });
  if (!current) {
    const error = new Error('Link not found');
    error.statusCode = 404;
    error.payload = { error: 'Link not found' };
    throw error;
  }

  if (options.hardDelete) {
    await linksCollection.deleteOne({ id });
  } else {
    const deletedAt = new Date().toISOString();
    await linksCollection.updateOne(
      { id },
      { $set: { deletedAt, updatedAt: deletedAt, status: 'archived', pinned: false } }
    );
  }

  return { total: await linksCollection.countDocuments({ deletedAt: null }) };
}

async function restoreLink(id) {
  const current = await linksCollection.findOne({ id }, { projection: { _id: 0 } });
  if (!current) {
    throw Object.assign(new Error('Link not found'), {
      statusCode: 404,
      payload: { error: 'Link not found' },
    });
  }
  if (!current.deletedAt) {
    return normalizeStoredEntry(current);
  }
  const restoredAt = new Date().toISOString();
  const next = {
    ...current,
    deletedAt: null,
    updatedAt: restoredAt,
    status: current.status === 'archived' ? 'saved' : normalizeStatus(current.status || 'saved'),
  };
  await linksCollection.updateOne({ id }, { $set: next });
  return normalizeStoredEntry(next);
}

function parseBookmarksHtml(html) {
  const links = [];
  const regex = /<a\b([^>]*)>([^<]*)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const rawTitle = match[2].trim();
    const hrefMatch = attrs.match(/href="([^"]+)"/i);
    if (!hrefMatch) continue;
    const url = hrefMatch[1].trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    try { new URL(url); } catch { continue; }
    let date = new Date().toISOString().slice(0, 10);
    const dateMatch = attrs.match(/add_date="(\d+)"/i);
    if (dateMatch) {
      const d = new Date(Number(dateMatch[1]) * 1000);
      if (!isNaN(d.getTime()) && d.getFullYear() > 1990) {
        date = d.toISOString().slice(0, 10);
      }
    }
    links.push({ url, title: rawTitle || url, date, status: 'saved', tags: [] });
  }
  return links;
}

function isRoute(pathname, ...candidates) {
  return candidates.includes(pathname);
}

function linkIdFromPath(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const remainder = pathname.slice(prefix.length);
  if (!remainder || remainder.includes('/')) return null;
  return decodeURIComponent(remainder);
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const linksBasePath = isRoute(reqUrl.pathname, '/api/links', '/api/v1/links');
  const linkItemId = linkIdFromPath(reqUrl.pathname, '/api/links/') || linkIdFromPath(reqUrl.pathname, '/api/v1/links/');
  const linkRestoreId = linkIdFromPath(reqUrl.pathname, '/api/links/restore/') || linkIdFromPath(reqUrl.pathname, '/api/v1/links/restore/');

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/login', '/api/v1/login')) {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) return sendJson(res, 400, { error: 'Username and password are required' });
      const user = await authenticateUser(username, password);
      if (!user) return sendJson(res, 401, { error: 'Invalid username or password' });
      await createSession(res, user);
      return sendJson(res, 200, { ok: true, user: publicUser(user) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/auth/token', '/api/v1/auth/token')) {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) return sendJson(res, 400, { error: 'Username and password are required' });
      const user = await authenticateUser(username, password);
      if (!user) return sendJson(res, 401, { error: 'Invalid username or password' });
      const tokens = await issueTokenPair(user);
      return sendJson(res, 200, { ok: true, ...tokens });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/auth/refresh', '/api/v1/auth/refresh')) {
    try {
      const body = ensurePlainObject(await parseBody(req));
      const refreshToken = String(body.refreshToken || '').trim();
      if (!refreshToken) return sendJson(res, 400, { error: 'refreshToken is required' });

      const storedToken = await findValidRefreshToken(refreshToken);
      if (!storedToken) return sendJson(res, 401, { error: 'Invalid or expired refresh token' });

      const user = await usersCollection.findOne(
        { id: storedToken.userId, username: storedToken.username },
        { projection: { _id: 0, passwordHash: 0 } }
      );
      if (!user) return sendJson(res, 401, { error: 'Invalid refresh token user' });

      await revokeRefreshToken(refreshToken);
      const tokens = await issueTokenPair(user);
      return sendJson(res, 200, { ok: true, ...tokens });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
    }
  }

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/auth/logout', '/api/v1/auth/logout')) {
    try {
      const body = ensurePlainObject(await parseBody(req));
      const revoked = await revokeRefreshToken(String(body.refreshToken || '').trim());
      return sendJson(res, 200, { ok: true, revoked });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/logout', '/api/v1/logout')) {
    await destroySession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && isRoute(reqUrl.pathname, '/api/me', '/api/v1/me')) {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return sendJson(res, 401, { error: 'Authentication required' }, { 'Set-Cookie': clearCookie() });
    return sendJson(res, 200, { user: auth.user, authMethod: auth.method });
  }

  if (isApiPath(reqUrl.pathname) && ![
    '/api/login', '/api/logout', '/api/auth/token', '/api/auth/refresh', '/api/auth/logout', '/api/me',
    '/api/v1/login', '/api/v1/logout', '/api/v1/auth/token', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/me',
  ].includes(reqUrl.pathname)) {
    const auth = await requireAuth(req, res);
    if (!auth) return;
  }

  if (req.method === 'GET' && isRoute(reqUrl.pathname, '/api/stats', '/api/v1/stats')) {
    try {
      await connectDb();
      const [total, unread, saved, useful, archived] = await Promise.all([
        linksCollection.countDocuments({ deletedAt: null }),
        linksCollection.countDocuments({ deletedAt: null, status: 'unread' }),
        linksCollection.countDocuments({ deletedAt: null, status: 'saved' }),
        linksCollection.countDocuments({ deletedAt: null, status: 'useful' }),
        linksCollection.countDocuments({ deletedAt: null, status: 'archived' }),
      ]);
      return sendJson(res, 200, { total, unread, saved, useful, archived });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && linksBasePath) {
    try {
      const query = parseLinkListQuery(reqUrl.searchParams);
      const result = await readLinks(query);
      return sendJson(res, 200, {
        ...result,
        query: {
          q: query.query,
          status: query.status || null,
          tag: query.tag || null,
          sort: query.sortField,
          order: query.sortOrder,
          includeDeleted: query.includeDeleted,
          updatedAfter: query.updatedAfter,
        },
      });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, error.payload || { error: error.message });
    }
  }

  if (req.method === 'GET' && isRoute(reqUrl.pathname, '/api/links/export', '/api/v1/links/export')) {
    try {
      const links = await readAllLinksForExport();
      return sendText(res, 200, JSON.stringify(links, null, 2) + '\n', 'application/json; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="links-export.json"',
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && isRoute(reqUrl.pathname, '/api/links/check-health', '/api/v1/links/check-health')) {
    try {
      await connectDb();
      const limit = parsePositiveInt(reqUrl.searchParams.get('limit'), 100, 1, 200);
      const docs = await linksCollection
        .find({ deletedAt: null }, { projection: { _id: 0, id: 1, url: 1, title: 1 } })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray();

      const BATCH = 8;
      const results = [];
      for (let i = 0; i < docs.length; i += BATCH) {
        const batch = docs.slice(i, i + BATCH);
        const settled = await Promise.allSettled(batch.map(async doc => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 7000);
          try {
            const r = await fetch(doc.url, {
              method: 'HEAD',
              signal: controller.signal,
              redirect: 'follow',
              headers: { 'User-Agent': 'Link Nest/0.1 (+health-check)' },
            });
            clearTimeout(timer);
            return { id: doc.id, url: doc.url, title: doc.title, ok: r.ok, status: r.status };
          } catch (err) {
            clearTimeout(timer);
            return { id: doc.id, url: doc.url, title: doc.title, ok: false, status: 0,
              error: err.name === 'AbortError' ? 'timeout' : 'unreachable' };
          }
        }));
        results.push(...settled.map(s => s.status === 'fulfilled' ? s.value : { ok: false, error: 'failed' }));
      }
      return sendJson(res, 200, { total: results.length, broken: results.filter(r => !r.ok).length, checks: results });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && isRoute(reqUrl.pathname, '/api/fetch-title', '/api/v1/fetch-title')) {
    try {
      const targetUrl = reqUrl.searchParams.get('url');
      if (!targetUrl) return sendJson(res, 400, { error: 'url query parameter is required' });
      const metadata = await fetchTitleForUrl(targetUrl);
      return sendJson(res, 200, metadata);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && linksBasePath) {
    try {
      const entry = await createLink(ensurePlainObject(await parseBody(req)));
      return sendJson(res, 201, { ok: true, entry });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
    }
  }

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/links/import', '/api/v1/links/import')) {
    try {
      const body = ensurePlainObject(await parseBody(req));
      const result = await importLinks(Array.isArray(body.links) ? body.links : []);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/links/import-bookmarks', '/api/v1/links/import-bookmarks')) {
    try {
      const body = ensurePlainObject(await parseBody(req));
      const html = String(body.html || '');
      if (!html) return sendJson(res, 400, { error: 'html field is required' });
      const bookmarks = parseBookmarksHtml(html);
      if (!bookmarks.length) return sendJson(res, 400, { error: 'No valid bookmarks found in the file' });
      const result = await importLinks(bookmarks);
      return sendJson(res, 200, { ok: true, ...result, parsed: bookmarks.length });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
    }
  }

  if (req.method === 'POST' && linkRestoreId) {
    try {
      const entry = await restoreLink(linkRestoreId);
      return sendJson(res, 200, { ok: true, entry });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
    }
  }

  if (req.method === 'PUT' && linkItemId) {
    try {
      const entry = await updateLink(linkItemId, ensurePlainObject(await parseBody(req)));
      return sendJson(res, 200, { ok: true, entry });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
    }
  }

  if (req.method === 'DELETE' && linkItemId) {
    try {
      const result = await deleteLink(linkItemId, {
        hardDelete: parseBooleanFlag(reqUrl.searchParams.get('hardDelete'), false),
      });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
    }
  }

  if (req.method === 'GET' && reqUrl.pathname === '/logout') {
    await destroySession(req, res);
    return sendRedirect(res, '/login.html');
  }

  if (req.method === 'GET' && PROTECTED_PAGES.has(reqUrl.pathname)) {
    const auth = await requireAuth(req, res);
    if (!auth) return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/login.html') {
    const auth = await getAuthenticatedUser(req);
    if (auth) return sendRedirect(res, '/browse.html');
  }

  if (req.method === 'GET' && reqUrl.pathname === '/sw.js') {
    const swPath = path.join(PUBLIC_DIR, 'sw.js');
    fs.readFile(swPath, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'Service-Worker-Allowed': '/',
      });
      res.end(data);
    });
    return;
  }

  const requested = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  if (!PUBLIC_PAGES.has(reqUrl.pathname) && !PROTECTED_PAGES.has(reqUrl.pathname) && reqUrl.pathname.endsWith('.html')) {
    const auth = await requireAuth(req, res);
    if (!auth) return;
  }
  sendFile(res, filePath);
});

async function start() {
  await connectDb();
  await ensureAdminUser();
  server.listen(PORT, () => {
    console.log(`Link Nest running at http://localhost:${PORT}`);
    console.log(`Using MongoDB database: ${DB_NAME}.${COLLECTION_NAME}`);
    console.log('Legacy JSON fallback is disabled.');
    console.log('Auth enabled with cookie sessions, bearer access tokens, and refresh tokens.');
  });
}

start().catch(error => {
  console.error('Failed to start Link Nest:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});

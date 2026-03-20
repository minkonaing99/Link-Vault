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
const DB_NAME = process.env.MONGODB_DB_NAME || 'linkvault';
const COLLECTION_NAME = 'links';
const USERS_COLLECTION = 'users';
const SESSIONS_COLLECTION = 'sessions';
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'linkvault_session';
const AUTH_SESSION_TTL_DAYS = Number(process.env.AUTH_SESSION_TTL_DAYS || 30);
const JWT_TTL_DAYS = Number(process.env.JWT_TTL_DAYS || 30);
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const ADMIN_USERNAME = String(process.env.LINKVAULT_ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = String(process.env.LINKVAULT_ADMIN_PASSWORD || '').trim();
const PROTECTED_PAGES = new Set(['/browse.html', '/editor.html', '/']);
const PUBLIC_PAGES = new Set(['/login.html']);

if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI. Put it in .env or the environment before starting Link Vault.');
}

if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET. Put it in .env before starting Link Vault.');
}

let mongoClient;
let db;
let linksCollection;
let usersCollection;
let sessionsCollection;

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

function sanitizeEntry(input = {}) {
  const rawUrl = String(input.url || '').trim();
  if (!rawUrl) throw new Error('URL is required');
  const cleanedUrl = normalizeUrl(rawUrl);
  return {
    id: input.id ? String(input.id) : makeId(),
    date: String(input.date || new Date().toISOString().slice(0, 10)).trim(),
    title: String(input.title || cleanedUrl).trim() || cleanedUrl,
    url: cleanedUrl,
    host: deriveHost(cleanedUrl),
    tags: normalizeTags(input.tags),
    notes: String(input.notes || '').trim(),
    status: normalizeStatus(String(input.status || 'saved').trim()),
    pinned: Boolean(input.pinned),
    updatedAt: new Date().toISOString(),
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
    notes: item.notes || '',
    status: normalizeStatus(item.status || 'saved'),
    pinned: Boolean(item.pinned),
    updatedAt: item.updatedAt || null,
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
      const oembedRes = await fetch(oembedUrl, { headers: { 'User-Agent': 'LinkVault/0.1 (+local)' } });
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
      'User-Agent': 'LinkVault/0.1 (+local)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  return { title: title || cleanedUrl, url: cleanedUrl, host };
}

async function connectDb() {
  if (linksCollection && usersCollection && sessionsCollection) return;
  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db(DB_NAME);
  linksCollection = db.collection(COLLECTION_NAME);
  usersCollection = db.collection(USERS_COLLECTION);
  sessionsCollection = db.collection(SESSIONS_COLLECTION);

  await Promise.all([
    linksCollection.createIndex({ id: 1 }, { unique: true }),
    linksCollection.createIndex({ url: 1 }, { unique: true }),
    linksCollection.createIndex({ updatedAt: -1 }),
    linksCollection.createIndex({ date: -1 }),
    linksCollection.createIndex({ title: 'text', notes: 'text', host: 'text', tags: 'text' }),
    usersCollection.createIndex({ username: 1 }, { unique: true }),
    sessionsCollection.createIndex({ token: 1 }, { unique: true }),
    sessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

async function ensureAdminUser() {
  await connectDb();
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn('No usable initial admin credentials found. Set LINKVAULT_ADMIN_USERNAME and LINKVAULT_ADMIN_PASSWORD in .env.');
    return;
  }
  const existing = await usersCollection.findOne({ username: ADMIN_USERNAME });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const timestamp = new Date().toISOString();

  if (!existing) {
    await usersCollection.insertOne({ id: makeId(), username: ADMIN_USERNAME, passwordHash, createdAt: timestamp, updatedAt: timestamp });
    console.log(`Created Link Vault admin user: ${ADMIN_USERNAME}`);
    return;
  }

  await usersCollection.updateOne({ username: ADMIN_USERNAME }, {
    $set: { passwordHash, updatedAt: timestamp },
    $setOnInsert: { id: makeId(), createdAt: timestamp },
  }, { upsert: true });
  console.log(`Synced Link Vault admin credentials for: ${ADMIN_USERNAME}`);
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
  return signJwt({ sub: user.id, username: user.username, type: 'access' }, JWT_TTL_DAYS * 24 * 60 * 60);
}

async function readLinks() {
  const docs = await linksCollection.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1, date: -1, title: 1 }).toArray();
  return docs.map(normalizeStoredEntry);
}

async function createLink(input) {
  const entry = sanitizeEntry(input);
  const existing = await linksCollection.findOne({ url: entry.url }, { projection: { _id: 0, url: 1 } });
  if (existing) {
    const error = new Error('This link already exists');
    error.statusCode = 409;
    error.payload = { error: 'This link already exists', url: entry.url };
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
  return { imported: added.length, total: await linksCollection.countDocuments({}) };
}

async function updateLink(id, body) {
  const current = await linksCollection.findOne({ id }, { projection: { _id: 0 } });
  if (!current) {
    const error = new Error('Link not found');
    error.statusCode = 404;
    error.payload = { error: 'Link not found' };
    throw error;
  }
  const entry = sanitizeEntry({ ...current, ...body, id });
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

async function deleteLink(id) {
  const result = await linksCollection.deleteOne({ id });
  if (!result.deletedCount) {
    const error = new Error('Link not found');
    error.statusCode = 404;
    error.payload = { error: 'Link not found' };
    throw error;
  }
  return { total: await linksCollection.countDocuments({}) };
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && reqUrl.pathname === '/api/login') {
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

  if (req.method === 'POST' && reqUrl.pathname === '/api/auth/token') {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) return sendJson(res, 400, { error: 'Username and password are required' });
      const user = await authenticateUser(username, password);
      if (!user) return sendJson(res, 401, { error: 'Invalid username or password' });
      const accessToken = createAccessToken(user);
      return sendJson(res, 200, {
        ok: true,
        tokenType: 'Bearer',
        accessToken,
        expiresIn: JWT_TTL_DAYS * 24 * 60 * 60,
        user: publicUser(user),
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/logout') {
    await destroySession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/me') {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return sendJson(res, 401, { error: 'Authentication required' }, { 'Set-Cookie': clearCookie() });
    return sendJson(res, 200, { user: auth.user, authMethod: auth.method });
  }

  if (isApiPath(reqUrl.pathname) && !['/api/login', '/api/logout', '/api/auth/token', '/api/me'].includes(reqUrl.pathname)) {
    const auth = await requireAuth(req, res);
    if (!auth) return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/links') {
    try {
      const links = await readLinks();
      return sendJson(res, 200, { links, total: links.length });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/links/export') {
    try {
      const links = await readLinks();
      return sendText(res, 200, JSON.stringify(links, null, 2) + '\n', 'application/json; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="links-export.json"',
      });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/fetch-title') {
    try {
      const targetUrl = reqUrl.searchParams.get('url');
      if (!targetUrl) return sendJson(res, 400, { error: 'url query parameter is required' });
      const metadata = await fetchTitleForUrl(targetUrl);
      return sendJson(res, 200, metadata);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/links') {
    try {
      const entry = await createLink(await parseBody(req));
      return sendJson(res, 201, { ok: true, entry });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
    }
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/links/import') {
    try {
      const body = await parseBody(req);
      const result = await importLinks(Array.isArray(body.links) ? body.links : []);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'PUT' && reqUrl.pathname.startsWith('/api/links/')) {
    try {
      const id = decodeURIComponent(reqUrl.pathname.split('/').pop());
      const entry = await updateLink(id, await parseBody(req));
      return sendJson(res, 200, { ok: true, entry });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
    }
  }

  if (req.method === 'DELETE' && reqUrl.pathname.startsWith('/api/links/')) {
    try {
      const id = decodeURIComponent(reqUrl.pathname.split('/').pop());
      const result = await deleteLink(id);
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
    console.log(`Link Vault running at http://localhost:${PORT}`);
    console.log(`Using MongoDB Atlas database: ${DB_NAME}.${COLLECTION_NAME}`);
    console.log('Legacy JSON fallback is disabled.');
    console.log('Auth enabled with cookie sessions and JWT bearer tokens.');
  });
}

start().catch(error => {
  console.error('Failed to start Link Vault:', error);
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

const http = require('http');
const path = require('path');
const { URL } = require('url');
const { PUBLIC_DIR, PROTECTED_PAGES, PUBLIC_PAGES } = require('./config');
const { sendJson, sendText, sendRedirect, sendFile, parseBody, SECURITY_HEADERS } = require('./http');
const { isApiPath, ensurePlainObject, parseLinkListQuery, parseBooleanFlag, parsePositiveInt, publicUser, assertPublicUrl } = require('./utils');
const {
  authenticateUser, createSession, destroySession,
  getAuthenticatedUser, requireAuth,
  issueTokenPair, revokeRefreshToken, findValidRefreshToken,
} = require('./auth');
const { collections, connectDb } = require('./db');
const {
  fetchTitleForUrl, parseBookmarksHtml,
  readLinks, readAllLinksForExport,
  createLink, importLinks, updateLink, deleteLink, restoreLink,
  readTagCounts, bulkUpdateStatus,
} = require('./links');

const fs = require('fs');
const { getClientIp, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } = require('./ratelimit');

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
    const ip = getClientIp(req);
    const rateCheck = checkLoginRateLimit(ip);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter));
      return sendJson(res, 429, { error: 'Too many login attempts. Please try again later.' });
    }
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) return sendJson(res, 400, { error: 'Username and password are required' });
      const user = await authenticateUser(username, password);
      if (!user) {
        recordFailedLogin(ip);
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }
      clearLoginAttempts(ip);
      await createSession(res, user);
      return sendJson(res, 200, { ok: true, user: publicUser(user) });
    } catch {
      return sendJson(res, 400, { error: 'Bad request' });
    }
  }

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/auth/token', '/api/v1/auth/token')) {
    const ip = getClientIp(req);
    const rateCheck = checkLoginRateLimit(ip);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter));
      return sendJson(res, 429, { error: 'Too many login attempts. Please try again later.' });
    }
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!username || !password) return sendJson(res, 400, { error: 'Username and password are required' });
      const user = await authenticateUser(username, password);
      if (!user) {
        recordFailedLogin(ip);
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }
      clearLoginAttempts(ip);
      const tokens = await issueTokenPair(user);
      return sendJson(res, 200, { ok: true, ...tokens });
    } catch {
      return sendJson(res, 400, { error: 'Bad request' });
    }
  }

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/auth/refresh', '/api/v1/auth/refresh')) {
    try {
      const body = ensurePlainObject(await parseBody(req));
      const refreshToken = String(body.refreshToken || '').trim();
      if (!refreshToken) return sendJson(res, 400, { error: 'refreshToken is required' });

      const storedToken = await findValidRefreshToken(refreshToken);
      if (!storedToken) return sendJson(res, 401, { error: 'Invalid or expired refresh token' });

      const user = await collections.users.findOne(
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
    if (!auth) return sendJson(res, 401, { error: 'Authentication required' }, { 'Set-Cookie': '' });
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
        collections.links.countDocuments({ deletedAt: null }),
        collections.links.countDocuments({ deletedAt: null, status: 'unread' }),
        collections.links.countDocuments({ deletedAt: null, status: 'saved' }),
        collections.links.countDocuments({ deletedAt: null, status: 'useful' }),
        collections.links.countDocuments({ deletedAt: null, status: 'archived' }),
      ]);
      return sendJson(res, 200, { total, unread, saved, useful, archived });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (req.method === 'GET' && isRoute(reqUrl.pathname, '/api/tags', '/api/v1/tags')) {
    try {
      const limit = parsePositiveInt(reqUrl.searchParams.get('limit'), 20, 1, 50);
      const tags = await readTagCounts(limit);
      return sendJson(res, 200, { tags });
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
      const docs = await collections.links
        .find({ deletedAt: null }, { projection: { _id: 0, id: 1, url: 1, title: 1 } })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray();

      const BATCH = 8;
      const results = [];
      for (let i = 0; i < docs.length; i += BATCH) {
        const batch = docs.slice(i, i + BATCH);
        const settled = await Promise.allSettled(batch.map(async doc => {
          try {
            await assertPublicUrl(doc.url);
          } catch {
            return { id: doc.id, url: doc.url, title: doc.title, ok: false, status: 0, error: 'blocked' };
          }
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

  if (req.method === 'POST' && isRoute(reqUrl.pathname, '/api/links/import', '/api/v1/links/import')) {
    try {
      const body = ensurePlainObject(await parseBody(req));
      const links = Array.isArray(body.links) ? body.links : [];
      if (links.length > 5000) return sendJson(res, 400, { error: 'Import batch cannot exceed 5000 items' });
      const result = await importLinks(links);
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

  if (req.method === 'POST' && linksBasePath) {
    try {
      const entry = await createLink(ensurePlainObject(await parseBody(req)));
      return sendJson(res, 201, { ok: true, entry });
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

  if (req.method === 'PATCH' && isRoute(reqUrl.pathname, '/api/links/bulk', '/api/v1/links/bulk')) {
    try {
      const body = ensurePlainObject(await parseBody(req));
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const status = String(body.status || '').trim();
      if (!status) return sendJson(res, 400, { error: 'status is required' });
      const result = await bulkUpdateStatus(ids, status);
      return sendJson(res, 200, { ok: true, ...result });
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
        ...SECURITY_HEADERS,
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

module.exports = { server };

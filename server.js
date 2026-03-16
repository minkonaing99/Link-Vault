const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3080;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const LINKS_FILE = path.resolve(ROOT, '../../links/links.json');

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

function ensureLinksFile() {
  const dir = path.dirname(LINKS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LINKS_FILE)) fs.writeFileSync(LINKS_FILE, '[]\n', 'utf8');
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

function readLinks() {
  ensureLinksFile();
  const raw = fs.readFileSync(LINKS_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('links.json must contain an array');
  return parsed.map(item => ({
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
  }));
}

function writeLinks(links) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2) + '\n', 'utf8');
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
  const response = await fetch(cleanedUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'LinkVault/0.1 (+local)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  return {
    title: title || cleanedUrl,
    url: cleanedUrl,
    host: deriveHost(cleanedUrl),
  };
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && reqUrl.pathname === '/api/links') {
    try {
      const links = readLinks()
        .slice()
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(b.date).localeCompare(String(a.date)) || String(a.title).localeCompare(String(b.title)));
      sendJson(res, 200, { links, total: links.length });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/links/export') {
    try {
      const links = readLinks();
      sendText(res, 200, JSON.stringify(links, null, 2) + '\n', 'application/json; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="links-export.json"',
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/fetch-title') {
    try {
      const targetUrl = reqUrl.searchParams.get('url');
      if (!targetUrl) return sendJson(res, 400, { error: 'url query parameter is required' });
      const metadata = await fetchTitleForUrl(targetUrl);
      sendJson(res, 200, metadata);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/links') {
    try {
      const body = await parseBody(req);
      const entry = sanitizeEntry(body);
      const links = readLinks();
      if (links.some(item => item.url === entry.url)) {
        return sendJson(res, 409, { error: 'This link already exists', url: entry.url });
      }
      links.push(entry);
      writeLinks(links);
      sendJson(res, 201, { ok: true, entry });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/links/import') {
    try {
      const body = await parseBody(req);
      const incoming = Array.isArray(body.links) ? body.links : [];
      const existing = readLinks();
      const existingUrls = new Set(existing.map(item => item.url));
      const added = [];
      for (const raw of incoming) {
        try {
          const entry = sanitizeEntry(raw);
          if (existingUrls.has(entry.url)) continue;
          existing.push(entry);
          existingUrls.add(entry.url);
          added.push(entry);
        } catch {
          // ignore malformed entries during import
        }
      }
      writeLinks(existing);
      sendJson(res, 200, { ok: true, imported: added.length, total: existing.length });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'PUT' && reqUrl.pathname.startsWith('/api/links/')) {
    try {
      const id = decodeURIComponent(reqUrl.pathname.split('/').pop());
      const body = await parseBody(req);
      const links = readLinks();
      const index = links.findIndex(item => item.id === id);
      if (index === -1) return sendJson(res, 404, { error: 'Link not found' });
      const merged = { ...links[index], ...body, id };
      const entry = sanitizeEntry(merged);
      if (links.some((item, i) => i !== index && item.url === entry.url)) {
        return sendJson(res, 409, { error: 'Another link already uses this URL' });
      }
      links[index] = entry;
      writeLinks(links);
      sendJson(res, 200, { ok: true, entry });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'DELETE' && reqUrl.pathname.startsWith('/api/links/')) {
    try {
      const id = decodeURIComponent(reqUrl.pathname.split('/').pop());
      const links = readLinks();
      const next = links.filter(item => item.id !== id);
      if (next.length === links.length) return sendJson(res, 404, { error: 'Link not found' });
      writeLinks(next);
      sendJson(res, 200, { ok: true, total: next.length });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const requested = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Link Vault running at http://localhost:${PORT}`);
  console.log(`Using link store: ${LINKS_FILE}`);
});


const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');
const {
  ENTRY_TITLE_MAX_LENGTH, ENTRY_TAG_MAX_LENGTH, ENTRY_TAGS_MAX_COUNT,
  LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX,
} = require('./config');

function makeId() {
  return crypto.randomUUID();
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isApiPath(pathname) {
  return pathname.startsWith('/api/');
}

function normalizeUrl(input) {
  const url = new URL(input);
  const noisyParams = new Set([
    'fbclid', 'gclid', 'igshid', 'mc_eid', 'mkt_tok', 'ref', 'ref_src',
    'state', 'code', 'code_challenge', 'code_challenge_method', 'scope',
    'response_type', 'client_id', 'redirect_uri', 'returnurl', 'return_url',
    'ui_locales', 'requestsource', 'allowazureb2caccountcreation', 'isiol',
    'session_state', 'prompt', 'nonce',
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

function isPrivateIp(ip) {
  // IPv6 loopback / private / link-local
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // fc00::/7 unique-local
  if (/^fe80:/i.test(ip)) return true;              // fe80::/10 link-local

  if (!net.isIPv4(ip)) return false;

  const [a, b] = ip.split('.').map(Number);
  if (a === 0) return true;                                  // 0.0.0.0/8
  if (a === 10) return true;                                 // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true;        // 100.64.0.0/10 CGNAT
  if (a === 127) return true;                                // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;                   // 169.254.0.0/16 link-local / AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;         // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                   // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true;     // 198.18.0.0/15 benchmark
  if (a >= 240) return true;                                 // 240.0.0.0/4 reserved
  return false;
}

async function assertPublicUrl(urlString) {
  const parsed = new URL(urlString);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw validationError('Only HTTP and HTTPS URLs are allowed');
  }
  let address;
  try {
    ({ address } = await dns.lookup(parsed.hostname));
  } catch {
    throw validationError('Unable to resolve hostname');
  }
  if (isPrivateIp(address)) {
    throw validationError('URL resolves to a private or reserved address');
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = {
  makeId, makeSessionToken, isApiPath,
  normalizeUrl, deriveHost,
  normalizeStatus, normalizeTags,
  ensurePlainObject, validationError,
  parseBooleanFlag, parsePositiveInt,
  buildSort, parseLinkListQuery,
  sanitizeEntry, normalizeStoredEntry, publicUser,
  isPrivateIp, assertPublicUrl,
};

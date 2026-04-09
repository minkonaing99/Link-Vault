require('dotenv').config();

const path = require('path');

const PORT = Number(process.env.PORT || 3080);
const ROOT = path.join(__dirname, '..');
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

module.exports = {
  PORT, ROOT, PUBLIC_DIR,
  MONGODB_URI, DB_NAME, COLLECTION_NAME,
  USERS_COLLECTION, SESSIONS_COLLECTION, REFRESH_TOKENS_COLLECTION,
  AUTH_COOKIE_NAME, AUTH_SESSION_TTL_DAYS,
  ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS,
  JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD,
  PROTECTED_PAGES, PUBLIC_PAGES,
  ENTRY_TITLE_MAX_LENGTH, ENTRY_TAG_MAX_LENGTH, ENTRY_TAGS_MAX_COUNT,
  LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX,
};

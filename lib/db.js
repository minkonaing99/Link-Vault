const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const {
  MONGODB_URI, DB_NAME, COLLECTION_NAME,
  USERS_COLLECTION, SESSIONS_COLLECTION, REFRESH_TOKENS_COLLECTION,
  ADMIN_USERNAME, ADMIN_PASSWORD,
} = require('./config');
const { makeId } = require('./utils');

const collections = {
  links: null,
  users: null,
  sessions: null,
  refreshTokens: null,
};

let mongoClient;
let connected = false;

async function connectDb() {
  if (connected) return;
  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  const db = mongoClient.db(DB_NAME);
  collections.links = db.collection(COLLECTION_NAME);
  collections.users = db.collection(USERS_COLLECTION);
  collections.sessions = db.collection(SESSIONS_COLLECTION);
  collections.refreshTokens = db.collection(REFRESH_TOKENS_COLLECTION);

  try {
    const indexes = await collections.links.indexes();
    const legacyNotesTextIndex = indexes.find(index =>
      index.name === 'title_text_notes_text_host_text_tags_text'
    );
    if (legacyNotesTextIndex) {
      await collections.links.dropIndex(legacyNotesTextIndex.name);
    }
  } catch {
  }

  await Promise.all([
    collections.links.createIndex({ id: 1 }, { unique: true }),
    collections.links.createIndex({ url: 1 }, { unique: true }),
    collections.links.createIndex({ updatedAt: -1 }),
    collections.links.createIndex({ createdAt: -1 }),
    collections.links.createIndex({ date: -1 }),
    collections.links.createIndex({ deletedAt: 1 }),
    collections.links.createIndex({ status: 1, updatedAt: -1 }),
    collections.links.createIndex({ tags: 1, updatedAt: -1 }),
    collections.links.createIndex({ title: 'text', host: 'text', tags: 'text' }),
    collections.users.createIndex({ username: 1 }, { unique: true }),
    collections.sessions.createIndex({ token: 1 }, { unique: true }),
    collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.refreshTokens.createIndex({ token: 1 }, { unique: true }),
    collections.refreshTokens.createIndex({ userId: 1, revokedAt: 1 }),
    collections.refreshTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);

  connected = true;
}

async function ensureAdminUser() {
  await connectDb();
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn('No usable initial admin credentials found. Set LINKNEST_ADMIN_USERNAME and LINKNEST_ADMIN_PASSWORD in .env.');
    return;
  }
  const existing = await collections.users.findOne({ username: ADMIN_USERNAME });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const timestamp = new Date().toISOString();

  if (!existing) {
    await collections.users.insertOne({ id: makeId(), username: ADMIN_USERNAME, passwordHash, createdAt: timestamp, updatedAt: timestamp });
    console.log(`Created Link Nest admin user: ${ADMIN_USERNAME}`);
    return;
  }

  await collections.users.updateOne({ username: ADMIN_USERNAME }, {
    $set: { passwordHash, updatedAt: timestamp },
    $setOnInsert: { id: makeId(), createdAt: timestamp },
  }, { upsert: true });
  console.log(`Synced Link Nest admin credentials for: ${ADMIN_USERNAME}`);
}

async function closeDb() {
  if (mongoClient) await mongoClient.close();
}

module.exports = { collections, connectDb, ensureAdminUser, closeDb };

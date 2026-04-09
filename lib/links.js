const { collections } = require('./db');
const { LIST_LIMIT_DEFAULT } = require('./config');
const {
  buildSort, sanitizeEntry, normalizeStoredEntry,
  normalizeStatus, normalizeUrl, deriveHost, assertPublicUrl,
} = require('./utils');
const { fetchTitle } = require('./title');

async function fetchTitleForUrl(rawUrl) {
  const cleanedUrl = normalizeUrl(rawUrl);
  await assertPublicUrl(cleanedUrl);
  const host = deriveHost(cleanedUrl);
  const title = await fetchTitle(cleanedUrl, host);
  return { title: title || cleanedUrl, url: cleanedUrl, host };
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
    collections.links.find(params.filter, { projection: { _id: 0 } })
      .sort(params.sort).skip(params.skip).limit(params.limit).toArray(),
    collections.links.countDocuments(params.filter),
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
  const docs = await collections.links
    .find({}, { projection: { _id: 0 } })
    .sort(buildSort('updatedAt', 'desc'))
    .toArray();
  return docs.map(normalizeStoredEntry);
}

async function createLink(input) {
  const entry = sanitizeEntry(input);
  const existing = await collections.links.findOne(
    { url: entry.url },
    { projection: { _id: 0, id: 1, url: 1, deletedAt: 1 } }
  );
  if (existing) {
    const error = new Error('This link already exists');
    error.statusCode = 409;
    error.payload = {
      error: existing.deletedAt ? 'This link already exists but is archived' : 'This link already exists',
      url: entry.url,
      id: existing.id,
      archived: Boolean(existing.deletedAt),
    };
    throw error;
  }
  await collections.links.insertOne(entry);
  return normalizeStoredEntry(entry);
}

async function importLinks(items) {
  const existingDocs = await collections.links.find({}, { projection: { _id: 0, url: 1 } }).toArray();
  const existingUrls = new Set(existingDocs.map(item => item.url));
  const added = [];
  for (const raw of items) {
    try {
      const entry = sanitizeEntry(raw);
      if (existingUrls.has(entry.url)) continue;
      await collections.links.insertOne(entry);
      existingUrls.add(entry.url);
      added.push(entry);
    } catch {
    }
  }
  return { imported: added.length, total: await collections.links.countDocuments({ deletedAt: null }) };
}

async function updateLink(id, body) {
  const current = await collections.links.findOne({ id }, { projection: { _id: 0 } });
  if (!current) {
    const error = new Error('Link not found');
    error.statusCode = 404;
    error.payload = { error: 'Link not found' };
    throw error;
  }
  const entry = sanitizeEntry({ ...current, ...body, id }, { existing: current });
  const duplicate = await collections.links.findOne(
    { url: entry.url, id: { $ne: id } },
    { projection: { _id: 0, id: 1 } }
  );
  if (duplicate) {
    const error = new Error('Another link already uses this URL');
    error.statusCode = 409;
    error.payload = { error: 'Another link already uses this URL' };
    throw error;
  }
  await collections.links.updateOne({ id }, { $set: entry });
  return normalizeStoredEntry(entry);
}

async function deleteLink(id, options = {}) {
  const current = await collections.links.findOne({ id }, { projection: { _id: 0 } });
  if (!current) {
    const error = new Error('Link not found');
    error.statusCode = 404;
    error.payload = { error: 'Link not found' };
    throw error;
  }

  if (options.hardDelete) {
    await collections.links.deleteOne({ id });
  } else {
    const deletedAt = new Date().toISOString();
    await collections.links.updateOne(
      { id },
      { $set: { deletedAt, updatedAt: deletedAt, status: 'archived', pinned: false } }
    );
  }

  return { total: await collections.links.countDocuments({ deletedAt: null }) };
}

async function restoreLink(id) {
  const current = await collections.links.findOne({ id }, { projection: { _id: 0 } });
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
  await collections.links.updateOne({ id }, { $set: next });
  return normalizeStoredEntry(next);
}

module.exports = {
  fetchTitleForUrl, parseBookmarksHtml,
  readLinks, readAllLinksForExport,
  createLink, importLinks, updateLink, deleteLink, restoreLink,
};

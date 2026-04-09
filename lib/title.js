// Maximum bytes to buffer from the response before giving up looking for </head>.
// <head> sections are rarely more than 20–30 KB; 50 KB is a generous ceiling.
const MAX_HEAD_BYTES = 50_000;

// ---------------------------------------------------------------------------
// oEmbed providers
// ---------------------------------------------------------------------------

const OEMBED_PROVIDERS = [
  {
    test: host => /(youtube\.com|youtu\.be)$/.test(host),
    endpoint: url => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  },
  {
    test: host => /vimeo\.com$/.test(host),
    endpoint: url => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  },
  {
    test: host => /soundcloud\.com$/.test(host),
    endpoint: url => `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  },
  {
    test: host => /(twitter\.com|x\.com)$/.test(host),
    endpoint: url => `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`,
  },
];

async function tryOembed(url, host) {
  const provider = OEMBED_PROVIDERS.find(p => p.test(host));
  if (!provider) return null;
  try {
    const res = await fetch(provider.endpoint(url), {
      headers: { 'User-Agent': 'LinkNest/0.1 (+local)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.title ? String(data.title).trim() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&lsquo;': '\u2018', '&rsquo;': '\u2019', '&ldquo;': '\u201C', '&rdquo;': '\u201D',
  '&copy;': '©', '&reg;': '®', '&trade;': '™', '&middot;': '·',
  '&bull;': '•', '&laquo;': '«', '&raquo;': '»',
};

function decodeHtmlEntities(str) {
  return str
    .replace(/&[a-z]+;/gi, m => NAMED_ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

// ---------------------------------------------------------------------------
// Charset detection
// ---------------------------------------------------------------------------

function extractCharset(source) {
  const m = source.match(/charset=["']?\s*([^"'\s;>,]+)/i);
  return m ? m[1].trim() : null;
}

function detectCharsetFromHtml(html) {
  const simple = html.match(/<meta[^>]+charset=["']?\s*([^"'\s;>]+)/i);
  if (simple) return simple[1].trim();
  return null;
}

// ---------------------------------------------------------------------------
// Stream HTML <head> only
// ---------------------------------------------------------------------------

async function streamHtmlHead(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'LinkNest/0.1 (+local)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  // Skip non-HTML responses (PDFs, images, etc.) without buffering them
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
    await response.body?.cancel().catch(() => {});
    return '';
  }

  const charsetFromHeader = extractCharset(contentType);
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      totalBytes += value.byteLength;
      if (totalBytes >= MAX_HEAD_BYTES) break;
      // </head> is pure ASCII so latin1 detection works across all encodings
      if (/<\/head>/i.test(Buffer.concat(chunks).toString('latin1'))) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const rawBuffer = Buffer.concat(chunks);

  // Rough UTF-8 pass to detect <meta charset> if the header didn't say
  const roughHtml = rawBuffer.toString('utf8');
  const charset = charsetFromHeader || detectCharsetFromHtml(roughHtml) || 'utf-8';

  try {
    return new TextDecoder(charset, { fatal: false }).decode(rawBuffer);
  } catch {
    return roughHtml;
  }
}

// ---------------------------------------------------------------------------
// Meta tag extraction
// ---------------------------------------------------------------------------

function extractMetaContent(html, attr, value) {
  // Handles both attribute orders
  const a = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]+content=["']([^"'<>]+)["']`, 'i');
  const b = new RegExp(`<meta[^>]+content=["']([^"'<>]+)["'][^>]+${attr}=["']${value}["']`, 'i');
  const m = html.match(a) || html.match(b);
  return m ? decodeHtmlEntities(m[1].trim()) : null;
}

function extractRawTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].replace(/\s+/g, ' ').trim()) : '';
}

// ---------------------------------------------------------------------------
// Title cleanup
// ---------------------------------------------------------------------------

const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' :: ', ' » ', ' · '];

function stripSiteSuffix(title) {
  for (const sep of TITLE_SEPARATORS) {
    const idx = title.lastIndexOf(sep);
    // Only strip if there's meaningful content before the separator
    if (idx > 5) return title.slice(0, idx).trim();
  }
  return title;
}

function pickBestTitle(rawTitle, ogTitle) {
  if (!rawTitle && !ogTitle) return '';
  if (!rawTitle) return ogTitle;
  if (!ogTitle) return stripSiteSuffix(rawTitle);

  // og:title is an intentional, clean title set by the site owner.
  // Prefer it unless it's suspiciously short (< 5 chars).
  if (ogTitle.length >= 5) return ogTitle;
  return stripSiteSuffix(rawTitle);
}

// ---------------------------------------------------------------------------
// Bad title detection (CAPTCHA / bot challenge pages)
// ---------------------------------------------------------------------------

const BAD_TITLE_PATTERNS = [
  /^just a moment/i,           // Cloudflare turnstile
  /^attention required/i,      // Cloudflare legacy
  /^checking your browser/i,
  /^please (wait|enable javascript)/i,
  /^access denied/i,
  /^(403|404|429|500|502|503)\b/,
  /^(error|blocked|captcha|robot check|security check)/i,
  /^ddos protection/i,
  /^verifying (you are|your browser)/i,
  /^one moment/i,
];

function isBadTitle(title) {
  if (!title || title.trim().length < 2) return true;
  return BAD_TITLE_PATTERNS.some(re => re.test(title.trim()));
}

// ---------------------------------------------------------------------------
// Microlink fallback
// ---------------------------------------------------------------------------

async function tryMicrolink(url) {
  try {
    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'LinkNest/0.1 (+local)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'success') return null;
    return data.data?.title ? String(data.data.title).trim() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

// Returns { title: string, needsManualEntry: boolean }
async function fetchTitle(url, host) {
  // 1. oEmbed: structured and reliable, try first for supported sites
  const oembedTitle = await tryOembed(url, host);
  if (oembedTitle && !isBadTitle(oembedTitle)) {
    return { title: oembedTitle, needsManualEntry: false };
  }

  // 2. Stream HTML head, detect encoding, extract best title
  const html = await streamHtmlHead(url).catch(() => '');
  if (html) {
    const ogTitle = extractMetaContent(html, 'property', 'og:title')
      || extractMetaContent(html, 'name', 'twitter:title');
    const rawTitle = extractRawTitle(html);
    const scraped = pickBestTitle(rawTitle, ogTitle);

    if (!isBadTitle(scraped)) {
      return { title: scraped, needsManualEntry: false };
    }
  }

  // 3. Microlink fallback — handles JS-rendered pages and CAPTCHA-protected sites
  const microlinkTitle = await tryMicrolink(url);
  if (microlinkTitle && !isBadTitle(microlinkTitle)) {
    return { title: microlinkTitle, needsManualEntry: false };
  }

  // 4. All methods exhausted — ask the user to enter the title manually
  return { title: '', needsManualEntry: true };
}

module.exports = { fetchTitle };

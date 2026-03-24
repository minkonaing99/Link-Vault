const { getLinks, safeHost, apiFetch, setMessage } = window.LinkVault;

const recentLinks = document.getElementById('recent-links');
const template = document.getElementById('link-template');
const quickAddForm = document.getElementById('quick-add-form');
const quickAddUrl = document.getElementById('quick-add-url');
const quickAddPaste = document.getElementById('quick-add-paste');
const quickAddMessage = document.getElementById('quick-add-message');

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function applyStatusStyles(dot, textEl, status) {
  const value = status || 'saved';
  dot.classList.add(`status-dot--${value}`);
  textEl.textContent = value;
}

function updateSummary(links) {
  const recent = links.slice().sort((a, b) =>
    String(b.updatedAt || b.date || '').localeCompare(String(a.updatedAt || a.date || ''))
  ).slice(0, 5);
  renderRecent(recent);
}

function renderRecent(items) {
  recentLinks.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No links saved yet.';
    recentLinks.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = template.content.cloneNode(true);
    node.querySelector('.link-date').textContent = item.date || 'Unknown date';
    node.querySelector('.link-host').textContent = item.host || safeHost(item.url);
    const dot = node.querySelector('.status-dot');
    const statusText = node.querySelector('.status-text');
    applyStatusStyles(dot, statusText, item.status);
    const title = node.querySelector('.recent-row__title');
    title.textContent = item.title || item.url;
    title.href = item.url;
    title.title = item.title || item.url;
    fragment.appendChild(node);
  }
  recentLinks.appendChild(fragment);
}

async function fetchTitleMetadata(rawUrl) {
  const res = await apiFetch(`/api/fetch-title?url=${encodeURIComponent(rawUrl)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not fetch title');
  return data;
}

async function loadHome() {
  const links = await getLinks();
  updateSummary(links);
}

async function saveQuickAdd(rawUrl) {
  if (!rawUrl) {
    setMessage(quickAddMessage, 'Paste a URL first.', 'error');
    return;
  }

  setMessage(quickAddMessage, 'Fetching title...');

  try {
    const metadata = await fetchTitleMetadata(rawUrl);
    setMessage(quickAddMessage, 'Saving link...');

    const res = await apiFetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: metadata.url || rawUrl,
        title: metadata.title || metadata.url || rawUrl,
        date: todayString(),
        status: 'saved',
        tags: [],
        pinned: false,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save link');

    quickAddForm.reset();
    setMessage(quickAddMessage, 'Link saved.', 'success');
    await loadHome();
  } catch (error) {
    setMessage(quickAddMessage, error.message, 'error');
  }
}

quickAddForm.addEventListener('submit', async event => {
  event.preventDefault();
  await saveQuickAdd(quickAddUrl.value.trim());
});

quickAddPaste.addEventListener('click', async () => {
  if (!navigator.clipboard?.readText) {
    setMessage(quickAddMessage, 'Clipboard read is not supported in this browser.', 'error');
    return;
  }

  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      setMessage(quickAddMessage, 'Clipboard is empty.', 'error');
      return;
    }

    let url;
    try {
      url = new URL(text).toString();
    } catch {
      setMessage(quickAddMessage, 'Clipboard does not contain a valid link.', 'error');
      return;
    }

    quickAddUrl.value = url;
    await saveQuickAdd(url);
  } catch {
    setMessage(quickAddMessage, 'Clipboard permission denied or unavailable.', 'error');
  }
});

loadHome().catch(console.error);

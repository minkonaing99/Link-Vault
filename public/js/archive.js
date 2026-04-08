const LIMIT = 50;
const state = { links: [], page: 1, totalPages: 1, total: 0, loading: false };

const linkList    = document.getElementById('link-list');
const template    = document.getElementById('archive-template');
const totalCount  = document.getElementById('total-count');
const loadMoreWrap = document.getElementById('load-more-wrap');
const loadMoreBtn  = document.getElementById('load-more');

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function formatDeletedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `Deleted ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function buildRow(item) {
  const node = template.content.cloneNode(true);

  const titleEl = node.querySelector('.library-row__title');
  titleEl.textContent = item.title || item.url;
  titleEl.href = item.url;
  titleEl.title = item.title || item.url;

  const host = item.host || safeHost(item.url);
  node.querySelector('.link-host').textContent = host;
  node.querySelector('.link-date').textContent = item.date || '';
  node.querySelector('.deleted-at').textContent = formatDeletedAt(item.deletedAt);

  node.querySelector('.restore-button').addEventListener('click', async () => {
    try {
      const res = await window.LinkVault.apiFetch(`/api/links/restore/${encodeURIComponent(item.id)}`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Restore failed'); }
      await fetchPage(1, false);
    } catch (err) { alert(err.message); }
  });

  node.querySelector('.hard-delete-button').addEventListener('click', async () => {
    if (!confirm(`Permanently delete this link? This cannot be undone.\n\n${item.title}`)) return;
    try {
      const res = await window.LinkVault.apiFetch(`/api/links/${encodeURIComponent(item.id)}?hardDelete=true`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Delete failed'); }
      await fetchPage(1, false);
    } catch (err) { alert(err.message); }
  });

  return node;
}

function render(items) {
  linkList.innerHTML = '';
  totalCount.textContent = String(state.total);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No deleted links.';
    linkList.appendChild(empty);
  } else {
    const frag = document.createDocumentFragment();
    for (const item of items) frag.appendChild(buildRow(item));
    linkList.appendChild(frag);
  }

  const hasMore = state.page < state.totalPages;
  if (loadMoreWrap) loadMoreWrap.classList.toggle('hidden', !hasMore);
  if (loadMoreBtn && hasMore) {
    const remaining = state.total - state.links.length;
    loadMoreBtn.textContent = `Load ${Math.min(remaining, LIMIT)} more`;
    loadMoreBtn.disabled = false;
  }
}

async function fetchPage(page, append = false) {
  if (state.loading) return;
  state.loading = true;
  if (loadMoreBtn) { loadMoreBtn.textContent = 'Loading…'; loadMoreBtn.disabled = true; }

  try {
    const params = new URLSearchParams({ status: 'deleted', limit: LIMIT, page, sort: 'updatedAt', order: 'desc' });
    const res = await window.LinkVault.apiFetch(`/api/links?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');
    state.links = append ? [...state.links, ...data.links] : data.links;
    state.page = data.page;
    state.totalPages = data.pages;
    state.total = data.total;
    render(state.links);
  } catch (err) {
    console.error(err);
  } finally {
    state.loading = false;
  }
}

if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', () => fetchPage(state.page + 1, true));
}

if (window.LinkVault.initPullToRefresh) {
  window.LinkVault.initPullToRefresh(() => fetchPage(1, false));
}

fetchPage(1, false).catch(console.error);

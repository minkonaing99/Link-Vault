const LIMIT = 50;

const state = { links: [], page: 1, totalPages: 1, total: 0, loading: false };

const SORT_MAP = {
  recent:       { sort: 'updatedAt', order: 'desc' },
  'date-asc':   { sort: 'date',      order: 'asc'  },
  'title-asc':  { sort: 'title',     order: 'asc'  },
  'title-desc': { sort: 'title',     order: 'desc' },
};

const linkList       = document.getElementById('link-list');
const template       = document.getElementById('link-template');
const totalCount     = document.getElementById('total-count');
const visibleCount   = document.getElementById('visible-count');
const searchInput    = document.getElementById('search');
const statusFilter   = document.getElementById('status-filter');
const sortModeSelect = document.getElementById('sort-mode');
const loadMoreWrap   = document.getElementById('load-more-wrap');
const loadMoreBtn    = document.getElementById('load-more');

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function applyStatusStyles(dot, textEl, status) {
  const value = status || 'saved';
  dot.className = 'status-dot';
  dot.classList.add(`status-dot--${value}`);
  textEl.textContent = value;
}

function formatDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function groupLabel(dateString) {
  if (!dateString) return 'Unknown date';
  const today = new Date();
  const todayStr = formatDateStr(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dateString === todayStr) return 'Today';
  if (dateString === formatDateStr(yesterday)) return 'Yesterday';
  return `Earlier · ${dateString}`;
}

async function togglePinned(item) {
  const res = await window.LinkVault.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...item, pinned: !item.pinned }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update pin state');
  }
  await fetchPage(1, false);
}

function closeAllMenus() {
  document.querySelectorAll('.row-menu__popover').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.row-menu__trigger').forEach(t => t.setAttribute('aria-expanded', 'false'));
  document.querySelectorAll('.row-menu').forEach(m => m.classList.remove('is-open'));
  document.querySelectorAll('.library-row').forEach(r => r.classList.remove('is-menu-open'));
}

function buildRow(item) {
  const node = template.content.cloneNode(true);

  const host = item.host || safeHost(item.url);
  node.querySelector('.link-host').textContent = host;
  node.querySelector('.link-date').textContent = item.date || 'Unknown date';

  const favicon = node.querySelector('.link-favicon');
  if (host) {
    favicon.src = `https://icons.duckduckgo.com/ip3/${host}.ico`;
    favicon.onerror = () => { favicon.style.display = 'none'; };
  } else {
    favicon.style.display = 'none';
  }

  applyStatusStyles(node.querySelector('.status-dot'), node.querySelector('.status-text'), item.status);

  const pinToggle = node.querySelector('.pin-toggle');
  pinToggle.textContent = item.pinned ? '★' : '☆';
  pinToggle.classList.toggle('is-pinned', Boolean(item.pinned));
  pinToggle.addEventListener('click', async event => {
    event.stopPropagation();
    try { await togglePinned(item); } catch (err) { alert(err.message); }
  });

  const titleEl = node.querySelector('.library-row__title');
  titleEl.textContent = item.title || item.url;
  titleEl.href = item.url;
  titleEl.title = item.title || item.url;

  const tagRow = node.querySelector('.library-row__tags');
  if (item.tags?.length) {
    tagRow.classList.remove('hidden');
    for (const tag of item.tags) {
      const el = document.createElement('span');
      el.className = 'badge tag';
      el.textContent = tag;
      el.addEventListener('click', event => {
        event.preventDefault();
        searchInput.value = tag;
        fetchPage(1, false);
        searchInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      tagRow.appendChild(el);
    }
  }

  node.querySelector('.edit-link').href = `/editor.html?id=${encodeURIComponent(item.id)}`;

  node.querySelector('.delete-button').addEventListener('click', async event => {
    event.stopPropagation();
    if (!confirm(`Delete this link?\n\n${item.title}`)) return;
    await window.LinkVault.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    closeAllMenus();
    await fetchPage(1, false);
  });

  const menu    = node.querySelector('.row-menu');
  const trigger = menu.querySelector('.row-menu__trigger');
  const popover = menu.querySelector('.row-menu__popover');
  const row     = node.querySelector('.library-row');

  trigger.addEventListener('click', event => {
    event.stopPropagation();
    const willOpen = popover.classList.contains('hidden');
    closeAllMenus();
    popover.classList.toggle('hidden', !willOpen);
    trigger.setAttribute('aria-expanded', String(willOpen));
    menu.classList.toggle('is-open', willOpen);
    row.classList.toggle('is-menu-open', willOpen);
  });

  return node;
}

function render(items) {
  linkList.innerHTML = '';
  totalCount.textContent = String(state.total);
  visibleCount.textContent = String(state.links.length);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No links match your current filters.';
    linkList.appendChild(empty);
  } else {
    const grouped = new Map();
    for (const item of items) {
      const label = item.pinned ? 'Pinned' : groupLabel(item.date);
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(item);
    }
    for (const [label, groupItems] of grouped) {
      const wrapper = document.createElement('section');
      wrapper.className = label === 'Pinned' ? 'date-group date-group--pinned' : 'date-group';
      const header = document.createElement('div');
      header.className = 'date-group__header';
      header.textContent = label;
      wrapper.appendChild(header);
      for (const item of groupItems) wrapper.appendChild(buildRow(item));
      linkList.appendChild(wrapper);
    }
  }

  const hasMore = state.page < state.totalPages;
  if (loadMoreWrap) loadMoreWrap.classList.toggle('hidden', !hasMore);
  if (loadMoreBtn && hasMore) {
    const remaining = state.total - state.links.length;
    loadMoreBtn.textContent = `Load ${Math.min(remaining, LIMIT)} more`;
    loadMoreBtn.disabled = false;
  }
}

function buildApiParams(page) {
  const params = new URLSearchParams({ page, limit: LIMIT });
  const q = searchInput.value.trim();
  const status = statusFilter.value;
  const { sort, order } = SORT_MAP[sortModeSelect.value] || SORT_MAP.recent;
  if (q) params.set('q', q);
  if (status !== 'all') params.set('status', status);
  params.set('sort', sort);
  params.set('order', order);
  return params;
}

async function fetchPage(page, append = false) {
  if (state.loading) return;
  state.loading = true;
  if (loadMoreBtn) { loadMoreBtn.textContent = 'Loading…'; loadMoreBtn.disabled = true; }

  try {
    const res = await window.LinkVault.apiFetch(`/api/links?${buildApiParams(page)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load links');
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

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

document.addEventListener('click', closeAllMenus);
searchInput.addEventListener('input', debounce(() => fetchPage(1, false), 300));
statusFilter.addEventListener('change', () => fetchPage(1, false));
sortModeSelect.addEventListener('change', () => fetchPage(1, false));

if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', () => fetchPage(state.page + 1, true));
}

const checkLinksBtn = document.getElementById('check-links-btn');
const healthPanel   = document.getElementById('health-panel');

async function runHealthCheck() {
  if (!checkLinksBtn || !healthPanel) return;
  checkLinksBtn.textContent = 'Checking…';
  checkLinksBtn.disabled = true;
  healthPanel.className = 'health-panel health-panel--loading';
  healthPanel.textContent = 'Checking links, this may take a moment…';

  try {
    const res = await window.LinkVault.apiFetch('/api/links/check-health?limit=100');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Health check failed');

    const broken = data.checks.filter(c => !c.ok);
    if (!broken.length) {
      healthPanel.className = 'health-panel health-panel--ok';
      healthPanel.textContent = `All ${data.total} links are reachable.`;
    } else {
      healthPanel.className = 'health-panel health-panel--broken';
      const summary = document.createElement('p');
      summary.className = 'health-summary';
      summary.textContent = `${broken.length} broken of ${data.total} checked`;
      const list = document.createElement('ul');
      list.className = 'health-list';
      for (const item of broken) {
        const li = document.createElement('li');
        li.className = 'health-item';
        const label = item.error ? `${item.error}` : `HTTP ${item.status}`;
        li.innerHTML = `<span class="health-item__label">${label}</span> <a href="${item.url}" target="_blank" rel="noreferrer" class="health-item__title">${item.title || item.url}</a>`;
        list.appendChild(li);
      }
      healthPanel.innerHTML = '';
      healthPanel.appendChild(summary);
      healthPanel.appendChild(list);
    }
  } catch (err) {
    healthPanel.className = 'health-panel health-panel--error';
    healthPanel.textContent = err.message;
  } finally {
    checkLinksBtn.textContent = 'Check links';
    checkLinksBtn.disabled = false;
  }
}

if (checkLinksBtn) {
  checkLinksBtn.addEventListener('click', runHealthCheck);
}

if (window.LinkVault.initPullToRefresh) {
  window.LinkVault.initPullToRefresh(() => fetchPage(1, false));
}

fetchPage(1, false).catch(console.error);

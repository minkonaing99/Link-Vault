const LIMIT = 50;
const STATUS_CYCLE = ['saved', 'unread', 'useful'];

const state = { links: [], page: 1, totalPages: 1, total: 0, loading: false, selectMode: false, selected: new Set() };

const SORT_MAP = {
  recent:       { sort: 'updatedAt', order: 'desc' },
  'date-asc':   { sort: 'date',      order: 'asc'  },
  'title-asc':  { sort: 'title',     order: 'asc'  },
  'title-desc': { sort: 'title',     order: 'desc' },
};

const linkList          = document.getElementById('link-list');
const template          = document.getElementById('link-template');
const totalCount        = document.getElementById('total-count');
const visibleCount      = document.getElementById('visible-count');
const searchInput       = document.getElementById('search');
const statusFilter      = document.getElementById('status-filter');
const sortModeSelect    = document.getElementById('sort-mode');
const pagination        = document.getElementById('pagination');
const bulkBar           = document.getElementById('bulk-bar');
const bulkCount         = document.getElementById('bulk-count');
const bulkSelectAllBtn  = document.getElementById('bulk-select-all');
const bulkDeleteBtn     = document.getElementById('bulk-delete-btn');
const bulkCancelBtn     = document.getElementById('bulk-cancel-btn');
const selectToggleBtn   = document.getElementById('select-toggle-btn');
const bulkStatusSelect  = document.getElementById('bulk-status-select');
const tagChipsContainer = document.getElementById('tag-chips');

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
  const res = await window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...item, pinned: !item.pinned }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update pin state');
  }
  await fetchPage(1);
}

function closeAllMenus() {
  document.querySelectorAll('.row-menu__popover').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.row-menu__trigger').forEach(t => t.setAttribute('aria-expanded', 'false'));
  document.querySelectorAll('.row-menu').forEach(m => m.classList.remove('is-open'));
  document.querySelectorAll('.library-row').forEach(r => r.classList.remove('is-menu-open'));
}

function updateBulkBar() {
  const count = state.selected.size;
  bulkCount.textContent = `${count} selected`;
  bulkDeleteBtn.disabled = count === 0;
  const allIds = state.links.map(l => l.id);
  bulkSelectAllBtn.textContent = allIds.every(id => state.selected.has(id)) ? 'Deselect all' : 'Select all';
}

function enterSelectMode() {
  state.selectMode = true;
  state.selected.clear();
  document.body.classList.add('is-selecting');
  bulkBar.classList.remove('hidden');
  selectToggleBtn.textContent = 'Done';
  updateBulkBar();
}

function exitSelectMode() {
  state.selectMode = false;
  state.selected.clear();
  document.body.classList.remove('is-selecting');
  bulkBar.classList.add('hidden');
  selectToggleBtn.textContent = 'Select';
  document.querySelectorAll('.library-row.is-selected').forEach(r => r.classList.remove('is-selected'));
}

async function bulkDelete() {
  if (!state.selected.size) return;
  const ids = [...state.selected];
  await Promise.all(ids.map(id => window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(id)}`, { method: 'DELETE' })));
  exitSelectMode();
  await fetchPage(state.page);
  window.LinkNest.updateUnreadBadge();
}

async function bulkChangeStatus(status) {
  if (!state.selected.size || !status) return;
  const ids = [...state.selected];
  try {
    const res = await window.LinkNest.apiFetch('/api/links/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
  } catch (err) {
    alert(err.message);
  }
  exitSelectMode();
  await fetchPage(state.page);
  window.LinkNest.updateUnreadBadge();
}

async function loadTagChips() {
  if (!tagChipsContainer) return;
  try {
    const res = await window.LinkNest.apiFetch('/api/tags?limit=15');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.tags || !data.tags.length) return;
    tagChipsContainer.innerHTML = '';
    for (const { tag } of data.tags) {
      const chip = document.createElement('span');
      chip.className = 'badge tag tag-chip';
      chip.textContent = tag;
      chip.dataset.tag = tag;
      chip.addEventListener('click', () => {
        const isActive = chip.classList.contains('is-active');
        tagChipsContainer.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('is-active'));
        if (isActive) {
          searchInput.value = '';
        } else {
          chip.classList.add('is-active');
          searchInput.value = tag;
        }
        fetchPage(1);
      });
      tagChipsContainer.appendChild(chip);
    }
    tagChipsContainer.classList.remove('hidden');
  } catch {
    // non-critical — chips are a progressive enhancement
  }
}

function buildRow(item) {
  const node = template.content.cloneNode(true);

  const rowArticle = node.querySelector('.library-row');
  if (state.selected.has(item.id)) rowArticle.classList.add('is-selected');

  // In select mode: whole row is a toggle; block link navigation
  rowArticle.addEventListener('click', e => {
    if (!state.selectMode) return;
    e.preventDefault();
    const nowSelected = !state.selected.has(item.id);
    if (nowSelected) { state.selected.add(item.id); rowArticle.classList.add('is-selected'); }
    else             { state.selected.delete(item.id); rowArticle.classList.remove('is-selected'); }
    updateBulkBar();
  });

  const host = item.host || safeHost(item.url);
  node.querySelector('.link-host').textContent = host;
  node.querySelector('.link-date').textContent = item.date || 'Unknown date';

  const statusDot = node.querySelector('.status-dot');
  const statusText = node.querySelector('.status-text');
  applyStatusStyles(statusDot, statusText, item.status);

  statusDot.title = 'Click to change status';
  statusDot.addEventListener('click', async event => {
    event.stopPropagation();
    if (state.selectMode) return;
    const current = item.status || 'saved';
    const idx = STATUS_CYCLE.indexOf(current);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    statusDot.classList.add('status-dot--transitioning');
    try {
      const res = await window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, status: next }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed'); }
      item.status = next;
      applyStatusStyles(statusDot, statusText, next);
      window.LinkNest.updateUnreadBadge();
    } catch (err) {
      alert(err.message);
    } finally {
      statusDot.classList.remove('status-dot--transitioning');
    }
  });

  const pinToggle = node.querySelector('.pin-toggle');
  pinToggle.textContent = item.pinned ? '★' : '☆';
  pinToggle.classList.toggle('is-pinned', Boolean(item.pinned));
  pinToggle.addEventListener('click', async event => {
    event.stopPropagation();
    try { await togglePinned(item); } catch (err) { alert(err.message); }
  });

  const titleEl = node.querySelector('.library-row__title');
  const rawTitle = item.title || item.url;
  titleEl.textContent = (() => { const limit = window.matchMedia('(max-width: 768px)').matches ? 55 : 70; return rawTitle.length > limit ? rawTitle.slice(0, limit) + '…' : rawTitle; })();
  titleEl.href = item.url;
  titleEl.title = rawTitle;

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
        fetchPage(1);
        searchInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      tagRow.appendChild(el);
    }
  }

  node.querySelector('.edit-link').href = `/editor.html?id=${encodeURIComponent(item.id)}`;

  node.querySelector('.delete-button').addEventListener('click', async event => {
    event.stopPropagation();
    if (!confirm(`Delete this link?\n\n${item.title}`)) return;
    await window.LinkNest.apiFetch(`/api/links/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    closeAllMenus();
    await fetchPage(1);
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

  renderPagination();
}

function renderPagination() {
  if (!pagination) return;
  const { page, totalPages } = state;
  if (totalPages <= 1) { pagination.classList.add('hidden'); return; }
  pagination.classList.remove('hidden');
  pagination.innerHTML = '';

  const btn = (label, targetPage, active = false, disabled = false) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pagination__btn' + (active ? ' pagination__btn--active' : '');
    el.textContent = label;
    el.disabled = disabled;
    if (!disabled && !active) el.addEventListener('click', () => { fetchPage(targetPage, false); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    return el;
  };

  pagination.appendChild(btn('‹', page - 1, false, page === 1));

  const delta = 2;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) pages.push(i);
  }
  let prev = null;
  for (const p of pages) {
    if (prev !== null && p - prev > 1) {
      const dots = document.createElement('span');
      dots.className = 'pagination__dots';
      dots.textContent = '…';
      pagination.appendChild(dots);
    }
    pagination.appendChild(btn(String(p), p, p === page));
    prev = p;
  }

  pagination.appendChild(btn('›', page + 1, false, page === totalPages));
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

async function fetchPage(page) {
  if (state.loading) return;
  state.loading = true;

  try {
    const res = await window.LinkNest.apiFetch(`/api/links?${buildApiParams(page)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load links');
    state.links = data.links;
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
searchInput.addEventListener('input', debounce(() => {
  // keep chip active state in sync with manual search
  if (tagChipsContainer) {
    const val = searchInput.value.trim();
    tagChipsContainer.querySelectorAll('.tag-chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.tag === val);
    });
  }
  fetchPage(1);
}, 300));
statusFilter.addEventListener('change', () => fetchPage(1));
sortModeSelect.addEventListener('change', () => fetchPage(1));

if (bulkStatusSelect) {
  bulkStatusSelect.addEventListener('change', async () => {
    const status = bulkStatusSelect.value;
    bulkStatusSelect.value = '';
    if (status) await bulkChangeStatus(status);
  });
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
    const res = await window.LinkNest.apiFetch('/api/links/check-health?limit=100');
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

if (checkLinksBtn) checkLinksBtn.addEventListener('click', runHealthCheck);

selectToggleBtn.addEventListener('click', () => {
  if (state.selectMode) exitSelectMode();
  else enterSelectMode();
});

bulkCancelBtn.addEventListener('click', exitSelectMode);

bulkDeleteBtn.addEventListener('click', bulkDelete);

bulkSelectAllBtn.addEventListener('click', () => {
  const allIds = state.links.map(l => l.id);
  const allSelected = allIds.every(id => state.selected.has(id));
  const rows = document.querySelectorAll('.library-row');
  if (allSelected) {
    allIds.forEach(id => state.selected.delete(id));
    rows.forEach(r => r.classList.remove('is-selected'));
  } else {
    allIds.forEach(id => state.selected.add(id));
    rows.forEach(r => r.classList.add('is-selected'));
  }
  updateBulkBar();
});

if (window.LinkNest.initPullToRefresh) {
  window.LinkNest.initPullToRefresh(() => fetchPage(1));
}

fetchPage(1).catch(console.error);
loadTagChips().catch(() => {});

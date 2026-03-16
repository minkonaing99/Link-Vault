const { getLinks, safeHost } = window.LinkVault;

const state = { links: [], filtered: [] };
const linkList = document.getElementById('link-list');
const template = document.getElementById('link-template');
const totalCount = document.getElementById('total-count');
const visibleCount = document.getElementById('visible-count');
const searchInput = document.getElementById('search');
const statusFilter = document.getElementById('status-filter');
const sortModeSelect = document.getElementById('sort-mode');

function applyStatusStyles(dot, textEl, status) {
  const value = status || 'saved';
  dot.className = 'status-dot';
  dot.classList.add(`status-dot--${value}`);
  textEl.textContent = value;
}

function formatDateString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function groupLabel(dateString) {
  if (!dateString) return 'Unknown date';

  const today = new Date();
  const todayStr = formatDateString(today);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = formatDateString(yesterday);

  if (dateString === todayStr) return 'Today';
  if (dateString === yesterdayStr) return 'Yesterday';
  return `Earlier · ${dateString}`;
}

function compareLinks(a, b, sortMode) {
  const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pinDiff !== 0) return pinDiff;

  if (sortMode === 'title-asc') {
    return String(a.title || '').localeCompare(String(b.title || ''));
  }
  if (sortMode === 'title-desc') {
    return String(b.title || '').localeCompare(String(a.title || ''));
  }
  if (sortMode === 'date-asc') {
    return String(a.date || '').localeCompare(String(b.date || '')) || String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
  }

  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    || String(b.date || '').localeCompare(String(a.date || ''))
    || String(a.title || '').localeCompare(String(b.title || ''));
}

async function togglePinned(item) {
  const res = await fetch(`/api/links/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...item, pinned: !item.pinned }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update pin state');
  }
  await load();
}

function buildRow(item) {
  const node = template.content.cloneNode(true);

  node.querySelector('.link-date').textContent = item.date || 'Unknown date';
  node.querySelector('.link-host').textContent = item.host || safeHost(item.url);

  const dot = node.querySelector('.status-dot');
  const statusText = node.querySelector('.status-text');
  applyStatusStyles(dot, statusText, item.status);

  const pinToggle = node.querySelector('.pin-toggle');
  pinToggle.textContent = item.pinned ? '★' : '☆';
  pinToggle.classList.toggle('is-pinned', Boolean(item.pinned));
  pinToggle.addEventListener('click', async () => {
    try {
      await togglePinned(item);
    } catch (error) {
      alert(error.message);
    }
  });

  const title = node.querySelector('.library-row__title');
  title.textContent = item.title || item.url;
  title.href = item.url;
  title.title = item.title || item.url;

  const urlLine = node.querySelector('.library-row__url');
  urlLine.textContent = item.url;

  const tagRow = node.querySelector('.library-row__tags');
  if (item.tags?.length) {
    tagRow.classList.remove('hidden');
    for (const tag of item.tags) {
      const el = document.createElement('span');
      el.className = 'badge tag';
      el.textContent = tag;
      tagRow.appendChild(el);
    }
  }

  const notes = node.querySelector('.library-row__notes');
  if (item.notes) {
    notes.textContent = item.notes;
    notes.classList.remove('hidden');
  }

  node.querySelector('.edit-link').href = `/editor.html?id=${encodeURIComponent(item.id)}`;
  node.querySelector('.delete-button').addEventListener('click', async () => {
    if (!confirm(`Delete this link?\n\n${item.title}`)) return;
    await fetch(`/api/links/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    await load();
  });

  return node;
}

function render(items) {
  linkList.innerHTML = '';
  totalCount.textContent = String(state.links.length);
  visibleCount.textContent = String(items.length);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No links match your current filters.';
    linkList.appendChild(empty);
    return;
  }

  const grouped = new Map();
  for (const item of items) {
    const label = item.pinned ? 'Pinned' : groupLabel(item.date);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(item);
  }

  for (const [label, groupItems] of grouped.entries()) {
    const wrapper = document.createElement('section');
    wrapper.className = label === 'Pinned' ? 'date-group date-group--pinned' : 'date-group';

    const header = document.createElement('div');
    header.className = 'date-group__header';
    header.textContent = label;
    wrapper.appendChild(header);

    for (const item of groupItems) {
      wrapper.appendChild(buildRow(item));
    }

    linkList.appendChild(wrapper);
  }
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const sortMode = sortModeSelect.value;

  state.filtered = state.links.filter(item => {
    if (status !== 'all' && item.status !== status) return false;
    if (!query) return true;
    return [item.title, item.url, item.host, item.date, item.notes, ...(item.tags || [])]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(query));
  });

  state.filtered.sort((a, b) => compareLinks(a, b, sortMode));
  render(state.filtered);
}

async function load() {
  state.links = await getLinks();
  applyFilters();
}

searchInput.addEventListener('input', applyFilters);
statusFilter.addEventListener('change', applyFilters);
sortModeSelect.addEventListener('change', applyFilters);

load().catch(console.error);

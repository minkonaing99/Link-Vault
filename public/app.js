const state = { links: [], filtered: [], editingId: null };

const els = {
  linkList: document.getElementById('link-list'),
  template: document.getElementById('link-template'),
  totalCount: document.getElementById('total-count'),
  visibleCount: document.getElementById('visible-count'),
  searchInput: document.getElementById('search'),
  statusFilter: document.getElementById('status-filter'),
  form: document.getElementById('link-form'),
  message: document.getElementById('form-message'),
  importMessage: document.getElementById('import-message'),
  date: document.getElementById('date'),
  id: document.getElementById('link-id'),
  title: document.getElementById('title'),
  url: document.getElementById('url'),
  tags: document.getElementById('tags'),
  status: document.getElementById('status'),
  submitButton: document.getElementById('submit-button'),
  formHeading: document.getElementById('form-heading'),
  cancelEdit: document.getElementById('cancel-edit'),
  fetchTitle: document.getElementById('fetch-title'),
  importFile: document.getElementById('import-file'),
};

els.date.value = new Date().toISOString().slice(0, 10);

function statusClass(status) {
  return `status-${status || 'saved'}`;
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function setMessage(target, text, kind = '') {
  target.textContent = text;
  target.className = `form-message ${kind}`.trim();
}

function resetForm() {
  state.editingId = null;
  els.form.reset();
  els.id.value = '';
  els.date.value = new Date().toISOString().slice(0, 10);
  els.status.value = 'saved';
  els.formHeading.textContent = 'Add a link';
  els.submitButton.textContent = 'Save link';
  els.cancelEdit.classList.add('hidden');
  setMessage(els.message, '');
}

function fillForm(item) {
  state.editingId = item.id;
  els.id.value = item.id;
  els.title.value = item.title || '';
  els.url.value = item.url || '';
  els.date.value = item.date || new Date().toISOString().slice(0, 10);
  els.status.value = item.status || 'saved';
  els.tags.value = (item.tags || []).join(', ');
  els.formHeading.textContent = 'Edit link';
  els.submitButton.textContent = 'Save changes';
  els.cancelEdit.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderLinks(items) {
  els.linkList.innerHTML = '';
  els.totalCount.textContent = String(state.links.length);
  els.visibleCount.textContent = String(items.length);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.links.length ? 'No links match your current filters.' : 'No links saved yet.';
    els.linkList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = els.template.content.cloneNode(true);
    node.querySelector('.link-date').textContent = item.date || 'Unknown date';
    node.querySelector('.link-host').textContent = item.host || safeHost(item.url);
    const badge = node.querySelector('.status-badge');
    badge.textContent = item.status || 'saved';
    badge.classList.add(statusClass(item.status));

    const title = node.querySelector('.link-title');
    title.textContent = item.title || item.url;
    title.href = item.url;

    node.querySelector('.link-url').textContent = item.url;

    const tagRow = node.querySelector('.tag-row');
    (item.tags || []).forEach(tag => {
      const el = document.createElement('span');
      el.className = 'badge tag';
      el.textContent = tag;
      tagRow.appendChild(el);
    });

    node.querySelector('.edit-button').addEventListener('click', () => fillForm(item));
    node.querySelector('.delete-button').addEventListener('click', async () => {
      const okay = confirm(`Delete this link?\n\n${item.title}`);
      if (!okay) return;
      await fetch(`/api/links/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      await loadLinks();
      if (state.editingId === item.id) resetForm();
    });

    fragment.appendChild(node);
  }
  els.linkList.appendChild(fragment);
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLowerCase();
  const status = els.statusFilter.value;
  state.filtered = state.links.filter(item => {
    const matchesStatus = status === 'all' || item.status === status;
    if (!matchesStatus) return false;
    if (!query) return true;
    return [item.title, item.url, item.host, item.date, ...(item.tags || [])]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(query));
  });
  renderLinks(state.filtered);
}

async function loadLinks() {
  const res = await fetch('/api/links');
  const data = await res.json();
  state.links = data.links || [];
  applyFilters();
}

function buildPayload() {
  return {
    id: els.id.value || undefined,
    title: els.title.value.trim(),
    url: els.url.value.trim(),
    date: els.date.value,
    status: els.status.value,
    tags: els.tags.value.split(',').map(t => t.trim()).filter(Boolean),
  };
}

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  setMessage(els.message, state.editingId ? 'Saving changes...' : 'Saving...');
  const payload = buildPayload();
  const method = state.editingId ? 'PUT' : 'POST';
  const url = state.editingId ? `/api/links/${encodeURIComponent(state.editingId)}` : '/api/links';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save link');
    setMessage(els.message, state.editingId ? 'Link updated.' : 'Link saved.', 'success');
    resetForm();
    await loadLinks();
  } catch (error) {
    setMessage(els.message, error.message, 'error');
  }
});

els.fetchTitle.addEventListener('click', async () => {
  const rawUrl = els.url.value.trim();
  if (!rawUrl) {
    setMessage(els.message, 'Enter a URL first.', 'error');
    return;
  }
  setMessage(els.message, 'Fetching title...');
  try {
    const res = await fetch(`/api/fetch-title?url=${encodeURIComponent(rawUrl)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not fetch title');
    els.url.value = data.url || rawUrl;
    if (!els.title.value.trim()) els.title.value = data.title || '';
    setMessage(els.message, 'Title fetched.', 'success');
  } catch (error) {
    setMessage(els.message, error.message, 'error');
  }
});

els.cancelEdit.addEventListener('click', resetForm);
els.searchInput.addEventListener('input', applyFilters);
els.statusFilter.addEventListener('change', applyFilters);

els.importFile.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const links = Array.isArray(parsed) ? parsed : parsed.links;
    if (!Array.isArray(links)) throw new Error('Import file must contain an array of links or { links: [...] }');
    const res = await fetch('/api/links/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    setMessage(els.importMessage, `Imported ${data.imported} links.`, 'success');
    event.target.value = '';
    await loadLinks();
  } catch (error) {
    setMessage(els.importMessage, error.message, 'error');
  }
});

loadLinks().catch(error => {
  setMessage(els.message, `Could not load links: ${error.message}`, 'error');
});

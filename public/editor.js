const { getLinks, setMessage, parseTags, queryParam } = window.LinkVault;

const els = {
  form: document.getElementById('link-form'),
  id: document.getElementById('link-id'),
  title: document.getElementById('title'),
  url: document.getElementById('url'),
  date: document.getElementById('date'),
  status: document.getElementById('status'),
  tags: document.getElementById('tags'),
  notes: document.getElementById('notes'),
  fetchTitle: document.getElementById('fetch-title'),
  pasteClipboard: document.getElementById('paste-clipboard'),
  submitButton: document.getElementById('submit-button'),
  formHeading: document.getElementById('form-heading'),
  pageTitle: document.getElementById('page-title'),
  message: document.getElementById('form-message'),
  batchInput: document.getElementById('batch-input'),
  batchImport: document.getElementById('batch-import'),
  importMessage: document.getElementById('import-message'),
};

els.date.value = new Date().toISOString().slice(0, 10);

function payload() {
  return {
    id: els.id.value || undefined,
    title: els.title.value.trim(),
    url: els.url.value.trim(),
    date: els.date.value,
    status: els.status.value,
    tags: parseTags(els.tags.value),
    notes: els.notes.value.trim(),
  };
}

function parseBatchLines(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|');
      const url = (parts[0] || '').trim();
      const title = parts.slice(1).join('|').trim();
      return { url, title };
    })
    .filter(item => item.url);
}

async function loadForEdit() {
  const id = queryParam('id');
  if (!id) return;
  const links = await getLinks();
  const item = links.find(link => link.id === id);
  if (!item) return;
  els.id.value = item.id;
  els.title.value = item.title || '';
  els.url.value = item.url || '';
  els.date.value = item.date || new Date().toISOString().slice(0, 10);
  els.status.value = item.status || 'saved';
  els.tags.value = (item.tags || []).join(', ');
  els.notes.value = item.notes || '';
  els.formHeading.textContent = 'Edit link';
  els.pageTitle.textContent = 'Edit Link';
  els.submitButton.textContent = 'Save changes';
}

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  const editing = Boolean(els.id.value);
  setMessage(els.message, editing ? 'Saving changes...' : 'Saving...');
  try {
    const res = await fetch(editing ? `/api/links/${encodeURIComponent(els.id.value)}` : '/api/links', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save link');
    window.location.href = '/browse.html';
  } catch (error) {
    setMessage(els.message, error.message, 'error');
  }
});

async function fetchAndApplyTitle(rawUrl) {
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
}

els.fetchTitle.addEventListener('click', async () => {
  await fetchAndApplyTitle(els.url.value.trim());
});

els.pasteClipboard.addEventListener('click', async () => {
  if (!navigator.clipboard?.readText) {
    setMessage(els.message, 'Clipboard read is not supported in this browser.', 'error');
    return;
  }
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      setMessage(els.message, 'Clipboard is empty.', 'error');
      return;
    }
    let url;
    try {
      url = new URL(text).toString();
    } catch {
      setMessage(els.message, 'Clipboard does not contain a valid link.', 'error');
      return;
    }
    els.url.value = url;
    setMessage(els.message, 'Link pasted from clipboard.', 'success');
    await fetchAndApplyTitle(url);
  } catch (error) {
    setMessage(els.message, 'Clipboard permission denied or unavailable.', 'error');
  }
});

els.batchImport.addEventListener('click', async () => {
  const raw = els.batchInput.value.trim();
  if (!raw) return setMessage(els.importMessage, 'Paste at least one line first.', 'error');

  const links = parseBatchLines(raw).map(item => ({
    url: item.url,
    title: item.title,
    date: new Date().toISOString().slice(0, 10),
    status: 'saved',
    tags: [],
    notes: '',
  }));

  if (!links.length) return setMessage(els.importMessage, 'No valid lines found.', 'error');

  try {
    const res = await fetch('/api/links/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    setMessage(els.importMessage, `Imported ${data.imported} links.`, 'success');
    els.batchInput.value = '';
  } catch (error) {
    setMessage(els.importMessage, error.message, 'error');
  }
});

loadForEdit().catch(console.error);

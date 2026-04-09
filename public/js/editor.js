const { getLinks, setMessage, parseTags, queryParam, apiFetch } = window.LinkNest;

const els = {
  form: document.getElementById('link-form'),
  id: document.getElementById('link-id'),
  title: document.getElementById('title'),
  url: document.getElementById('url'),
  date: document.getElementById('date'),
  status: document.getElementById('status'),
  tags: document.getElementById('tags'),
  fetchTitle: document.getElementById('fetch-title'),
  pasteClipboard: document.getElementById('paste-clipboard'),
  submitButton: document.getElementById('submit-button'),
  formHeading: document.getElementById('form-heading'),
  pageTitle: document.getElementById('page-title'),
  message: document.getElementById('form-message'),
  batchInput: document.getElementById('batch-input'),
  batchImport: document.getElementById('batch-import'),
  importMessage: document.getElementById('import-message'),
  bookmarksFile: document.getElementById('bookmarks-file'),
  bookmarksImport: document.getElementById('bookmarks-import'),
  bookmarksMessage: document.getElementById('bookmarks-message'),
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

async function fetchTitleMetadata(rawUrl) {
  const res = await apiFetch(`/api/fetch-title?url=${encodeURIComponent(rawUrl)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not fetch title');
  return data;
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
  els.formHeading.textContent = 'Edit link';
  els.pageTitle.textContent = 'Edit Link';
  els.submitButton.textContent = 'Save changes';
}

els.form.addEventListener('submit', async event => {
  event.preventDefault();
  const editing = Boolean(els.id.value);
  setMessage(els.message, editing ? 'Saving changes...' : 'Saving...');
  try {
    const res = await apiFetch(editing ? `/api/links/${encodeURIComponent(els.id.value)}` : '/api/links', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const data = await res.json();
    if (res.status === 409) {
      setMessage(els.message, data.error, 'error');
      const action = document.createElement('a');
      if (data.archived) {
        action.textContent = ' Restore it?';
        action.href = '#';
        action.addEventListener('click', async e => {
          e.preventDefault();
          setMessage(els.message, 'Restoring...');
          try {
            const r = await apiFetch(`/api/links/restore/${encodeURIComponent(data.id)}`, { method: 'POST' });
            if (!r.ok) throw new Error((await r.json()).error || 'Restore failed');
            setMessage(els.message, 'Link restored to library.', 'success');
          } catch (err) {
            setMessage(els.message, err.message, 'error');
          }
        });
      } else {
        action.textContent = ' Edit it?';
        action.href = `/editor.html?id=${encodeURIComponent(data.id)}`;
      }
      els.message.appendChild(action);
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Failed to save link');
    setMessage(els.message, editing ? 'Link updated.' : 'Link saved.', 'success');
    if (!editing) {
      els.form.reset();
      els.id.value = '';
      els.date.value = new Date().toISOString().slice(0, 10);
      els.status.value = 'saved';
    }
  } catch (error) {
    setMessage(els.message, error.message, 'error');
  }
});

async function fetchAndApplyTitle(rawUrl) {
  if (!rawUrl) {
    setMessage(els.message, 'Enter a URL first.', 'error');
    return;
  }
  els.title.value = '';
  setMessage(els.message, 'Fetching title...');
  try {
    const data = await fetchTitleMetadata(rawUrl);
    els.url.value = data.url || rawUrl;
    els.title.value = data.title || '';
    if (data.needsManualEntry) {
      setMessage(els.message, 'Could not fetch title (site may have bot protection) — please enter it manually.', 'error');
      els.title.focus();
    } else {
      setMessage(els.message, 'Title fetched.', 'success');
    }
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
  } catch {
    setMessage(els.message, 'Clipboard permission denied or unavailable.', 'error');
  }
});

els.batchImport.addEventListener('click', async () => {
  const raw = els.batchInput.value.trim();
  if (!raw) return setMessage(els.importMessage, 'Paste at least one line first.', 'error');

  const parsed = parseBatchLines(raw);
  if (!parsed.length) return setMessage(els.importMessage, 'No valid lines found.', 'error');

  setMessage(els.importMessage, `Preparing ${parsed.length} link(s)...`);
  const today = new Date().toISOString().slice(0, 10);
  const links = [];

  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    let finalUrl = item.url;
    let finalTitle = item.title;

    if (!finalTitle) {
      try {
        const metadata = await fetchTitleMetadata(item.url);
        finalUrl = metadata.url || item.url;
        finalTitle = metadata.title || '';
      } catch {
        finalTitle = '';
      }
    }

    links.push({
      url: finalUrl,
      title: finalTitle,
      date: today,
      status: 'saved',
      tags: [],
    });

    setMessage(els.importMessage, `Preparing ${i + 1}/${parsed.length}...`);
  }

  try {
    const res = await apiFetch('/api/links/import', {
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

async function loadFromShareParams() {
  if (queryParam('id')) return;
  const urlParam = queryParam('url');
  if (!urlParam) return;
  els.url.value = urlParam;
  const titleParam = queryParam('title');
  if (titleParam) {
    els.title.value = titleParam;
  } else {
    await fetchAndApplyTitle(urlParam);
  }
}

const importExportToggle = document.getElementById('import-export-toggle');
const importExportBody   = document.getElementById('import-export-body');
if (importExportToggle && importExportBody) {
  importExportToggle.addEventListener('click', () => {
    const open = !importExportBody.classList.contains('hidden');
    importExportBody.classList.toggle('hidden', open);
    importExportToggle.classList.toggle('is-open', !open);
  });
}

if (els.bookmarksImport) {
  els.bookmarksImport.addEventListener('click', async () => {
    const file = els.bookmarksFile?.files?.[0];
    if (!file) return setMessage(els.bookmarksMessage, 'Choose a bookmarks HTML file first.', 'error');
    setMessage(els.bookmarksMessage, 'Reading file…');
    try {
      const html = await file.text();
      setMessage(els.bookmarksMessage, 'Importing…');
      const res = await apiFetch('/api/links/import-bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setMessage(els.bookmarksMessage, `Imported ${data.imported} of ${data.parsed} bookmarks.`, 'success');
      if (els.bookmarksFile) els.bookmarksFile.value = '';
    } catch (err) {
      setMessage(els.bookmarksMessage, err.message, 'error');
    }
  });
}

loadForEdit().catch(console.error);
loadFromShareParams().catch(console.error);

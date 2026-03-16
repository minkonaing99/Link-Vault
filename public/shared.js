window.LinkVault = {
  async getLinks() {
    const res = await fetch('/api/links');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load links');
    return data.links || [];
  },

  statusClass(status) {
    return `status-${status || 'saved'}`;
  },

  safeHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  },

  setMessage(target, text, kind = '') {
    if (!target) return;
    target.textContent = text;
    target.className = `form-message ${kind}`.trim();
  },

  parseTags(value) {
    return String(value || '').split(',').map(t => t.trim()).filter(Boolean);
  },

  queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  },
};

async function linkVaultApiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
  });

  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Authentication required');
  }

  return res;
}

window.LinkVault = {
  apiFetch: linkVaultApiFetch,

  async getLinks() {
    const res = await linkVaultApiFetch('/api/links');
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

  async logout() {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      window.location.href = '/login.html';
    }
  },
};

window.addEventListener('DOMContentLoaded', () => {
  const logoutButton = document.getElementById('logout-button');
  if (!logoutButton) return;
  logoutButton.addEventListener('click', () => {
    window.LinkVault.logout().catch(() => {
      window.location.href = '/login.html';
    });
  });
});

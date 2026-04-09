async function linkNestApiFetch(url, options = {}) {
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

window.LinkNest = {
  apiFetch: linkNestApiFetch,

  async getLinks() {
    const res = await linkNestApiFetch('/api/links');
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
    window.LinkNest.logout().catch(() => {
      window.location.href = '/login.html';
    });
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Keyboard shortcuts: "/" to focus search, Escape to clear it
document.addEventListener('keydown', e => {
  const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === '/' && !inInput && !e.metaKey && !e.ctrlKey) {
    const search = document.getElementById('search');
    if (search) { e.preventDefault(); search.focus(); }
  }
  if (e.key === 'Escape') {
    const search = document.getElementById('search');
    if (search && document.activeElement === search) {
      search.value = '';
      search.blur();
      search.dispatchEvent(new Event('input'));
    }
  }
});

// Pull-to-refresh utility for mobile
window.LinkNest.initPullToRefresh = function (onRefresh) {
  const indicator = document.createElement('div');
  indicator.className = 'ptr-indicator';
  document.body.appendChild(indicator);

  let startY = 0;
  let active = false;
  const THRESHOLD = 65;

  document.addEventListener('touchstart', e => {
    if (window.scrollY <= 0) { startY = e.touches[0].clientY; active = true; }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!active) return;
    indicator.classList.toggle('ptr-visible', e.touches[0].clientY - startY > 30);
  }, { passive: true });

  document.addEventListener('touchend', async e => {
    if (!active) return;
    active = false;
    if (e.changedTouches[0].clientY - startY > THRESHOLD) {
      indicator.classList.add('ptr-visible', 'ptr-spinning');
      try { await onRefresh(); } finally {
        indicator.classList.remove('ptr-visible', 'ptr-spinning');
      }
    } else {
      indicator.classList.remove('ptr-visible');
    }
  }, { passive: true });
};

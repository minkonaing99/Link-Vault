const { getLinks, safeHost } = window.LinkVault;

const totalCount = document.getElementById('total-count');
const unreadCount = document.getElementById('unread-count');
const usefulCount = document.getElementById('useful-count');
const recentLinks = document.getElementById('recent-links');
const template = document.getElementById('link-template');

function applyStatusStyles(dot, textEl, status) {
  const value = status || 'saved';
  dot.classList.add(`status-dot--${value}`);
  textEl.textContent = value;
}

function renderRecent(items) {
  recentLinks.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No links saved yet.';
    recentLinks.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = template.content.cloneNode(true);
    node.querySelector('.link-date').textContent = item.date || 'Unknown date';
    node.querySelector('.link-host').textContent = item.host || safeHost(item.url);
    const dot = node.querySelector('.status-dot');
    const statusText = node.querySelector('.status-text');
    applyStatusStyles(dot, statusText, item.status);
    const title = node.querySelector('.recent-row__title');
    title.textContent = item.title || item.url;
    title.href = item.url;
    title.title = item.title || item.url;
    fragment.appendChild(node);
  }
  recentLinks.appendChild(fragment);
}

(async function init() {
  const links = await getLinks();
  totalCount.textContent = String(links.length);
  unreadCount.textContent = String(links.filter(l => l.status === 'unread').length);
  usefulCount.textContent = String(links.filter(l => l.status === 'useful').length);
  renderRecent(links.slice(0, 5));
})().catch(console.error);

const form = document.getElementById('login-form');
const username = document.getElementById('username');
const password = document.getElementById('password');
const message = document.getElementById('login-message');

function setMessage(text, kind = '') {
  message.textContent = text;
  message.className = `form-message login-message ${kind}`.trim();
}

(async function init() {
  username.focus();
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.ok) {
      window.location.href = '/browse.html';
    }
  } catch {
    // ignore
  }
})();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('Signing in...');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setMessage('Signed in.', 'success');
    window.location.href = '/browse.html';
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

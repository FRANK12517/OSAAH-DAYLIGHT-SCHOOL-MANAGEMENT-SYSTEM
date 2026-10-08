(() => {
  const status = document.querySelector('#msg-status');
  const list = document.querySelector('#message-list');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  async function api(url, options = {}) { const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`); return body; }
  async function load() {
    try {
      const result = await api('/api/communication/messages');
      list.innerHTML = result.messages?.length ? result.messages.map((message) => `<article class="msg-thread"><strong>${esc(message.senderId)}</strong> → <strong>${esc(message.recipientId)}</strong><p>${esc(message.body)}</p><small>${esc(message.createdAt)}</small></article>`).join('') : '<p>No in-app messages yet.</p>';
      status.textContent = 'In-app messages loaded.';
    } catch (error) { status.textContent = error.message; }
  }
  document.querySelector('#message-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try { await api('/api/communication/messages', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); status.textContent = 'In-app message sent.'; form.reset(); await load(); }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  load();
})();

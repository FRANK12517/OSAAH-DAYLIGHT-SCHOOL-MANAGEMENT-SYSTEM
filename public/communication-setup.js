const form = document.querySelector('#provider-form');
const controls = document.querySelector('#provider-controls');
const saveButton = document.querySelector('#save-provider');
const status = document.querySelector('#setup-status');
const accessNotice = document.querySelector('#setup-access-notice');
const list = document.querySelector('#providers');

async function requestJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function loadProviders() {
  const { response, data } = await requestJson('/api/developer/communication/providers');
  if (!response.ok) {
    list.textContent = data.error ?? `Unable to load providers (HTTP ${response.status}).`;
    return;
  }
  list.textContent = data.providers.map((provider) => `${provider.provider} · ${provider.active ? 'Active' : 'Inactive'} · credentials configured: ${provider.credentialsConfigured}`).join('\n') || 'No providers configured.';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (controls.disabled || saveButton.hidden) return;
  status.textContent = 'Saving provider…';
  saveButton.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    data.active = form.elements.active.checked;
    data.isDefault = form.elements.isDefault.checked;
    const { response, data: result } = await requestJson('/api/developer/communication/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data)
    });
    status.textContent = response.ok ? 'Provider saved securely.' : result.error ?? `Provider could not be saved (HTTP ${response.status}).`;
    if (response.ok) {
      form.reset();
      await loadProviders();
    }
  } catch (error) {
    status.textContent = `Provider could not be saved: ${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
});

async function initialize() {
  try {
    const { response, data } = await requestJson('/api/auth/session');
    const authorized = response.ok && data.user?.canManageCommunicationSetup === true;
    if (!authorized) {
      accessNotice.hidden = false;
      list.textContent = 'Provider configuration is restricted.';
      return;
    }
    controls.disabled = false;
    saveButton.hidden = false;
    await loadProviders();
  } catch (error) {
    accessNotice.hidden = false;
    accessNotice.textContent = `Unable to verify Communication Setup access: ${error.message}`;
    list.textContent = 'Provider configuration is restricted.';
  }
}

initialize();

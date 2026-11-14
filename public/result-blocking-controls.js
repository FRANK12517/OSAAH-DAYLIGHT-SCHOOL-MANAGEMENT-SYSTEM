(() => {
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  function chooseClass(classes, action) {
    const available = (classes || []).filter((item) => item && (item.id || item.name));
    if (!available.length) return Promise.reject(new Error('No configured classes are available.'));

    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-labelledby', 'result-blocking-title');
      dialog.innerHTML = `<form method="dialog" style="min-width:min(24rem,80vw);padding:1rem"><h2 id="result-blocking-title">${action === 'block' ? 'Block' : 'Unblock'} class results</h2><p>Select one configured class. This controls Parent Portal access for the selected academic year, term, and result type.</p><label for="result-blocking-class">Class</label><select id="result-blocking-class" required style="display:block;width:100%;margin:.5rem 0 1rem"></select><div style="display:flex;justify-content:flex-end;gap:.5rem"><button type="button" data-cancel>Cancel</button><button type="submit" data-confirm>${action === 'block' ? 'Continue' : 'Continue'}</button></div></form>`;
      const select = dialog.querySelector('select');
      select.innerHTML = '<option value="">Select one class</option>' + available.map((item) => `<option value="${escapeHtml(item.id || item.name)}">${escapeHtml(item.name || item.label || item.id)}</option>`).join('');
      let selected = null;
      dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
      dialog.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        if (!select.value) { select.reportValidity(); return; }
        const item = available.find((option) => String(option.id || option.name) === select.value);
        const className = item?.name || item?.label || item?.id || select.value;
        const verb = action === 'block' ? 'block' : 'unblock';
        if (!window.confirm(`Confirm ${verb}ing Parent Portal access to published results for ${className} only?`)) return;
        selected = select.value;
        dialog.close();
      });
      dialog.addEventListener('close', () => { dialog.remove(); resolve(selected); }, { once: true });
      document.body.append(dialog);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  window.OSAAHResultBlockingControls = Object.freeze({ chooseClass });
})();

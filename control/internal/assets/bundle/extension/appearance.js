(() => {
  if (globalThis.MangaAppearance) return;
  const key = 'appearance';
  const normalize = value => value === 'dark' || value === 'light' ? value : 'system';

  const modes = {
    system: {label: '시스템 설정', next: 'dark', path: 'M3 4h18v13H3z M12 17v3 M8 20h8'},
    dark: {label: '어둡게', next: 'light', path: 'M20.7 14.1A8.9 8.9 0 0 1 9.9 3.3a9 9 0 1 0 10.8 10.8Z'},
    light: {label: '밝게', next: 'system', path: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'}
  };
  function updateButton(button, preference) {
    const mode = modes[preference];
    button.querySelector('path').setAttribute('d', mode.path);
    button.title = '화면 테마 · ' + mode.label + ' (누르면 ' + modes[mode.next].label + ')';
    button.setAttribute('aria-label', button.title);
  }

  function attach(element, picker) {
    const system = matchMedia('(prefers-color-scheme: dark)');
    let preference = 'system';
    let changed = false;
    function apply() {
      const scheme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
      element.style.setProperty('color-scheme', scheme, 'important');
      if (picker) updateButton(picker, preference);
    }
    apply();
    system.addEventListener('change', apply);
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !changes[key]) return;
      changed = true;
      preference = normalize(changes[key].newValue);
      apply();
    });
    chrome.storage?.local.get(key).then(saved => {
      if (!changed) {
        preference = normalize(saved[key]);
        apply();
      }
    });
    picker?.addEventListener('click', async () => {
      changed = true;
      const previous = preference;
      preference = modes[preference].next;
      apply();
      try { await chrome.storage.local.set({[key]: preference}); }
      catch (error) {
        preference = previous;
        apply();
        document.getElementById('status').textContent = error.message;
      }
    });
  }

  globalThis.MangaAppearance = {attach};
  if (document.currentScript?.hasAttribute('data-appearance-page')) {
    attach(document.documentElement, document.getElementById('appearance'));
  }
})();

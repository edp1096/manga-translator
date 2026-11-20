// Loaded before paint by both the controller and its remote sign-in page.
(() => {
  const key = 'manga-translator.appearance';
  const normalize = value => ['light', 'dark'].includes(value) ? value : 'system';
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

  let preference;
  try { preference = localStorage.getItem(key); } catch { /* Storage can be disabled. */ }

  function apply(value) {
    preference = normalize(value);
    document.documentElement.dataset.appearance = preference;
    for (const button of document.querySelectorAll('appearance-picker button')) updateButton(button, preference);
  }

  apply(preference);
  window.addEventListener('storage', event => {
    if (event.storageArea === localStorage && (event.key === key || event.key === null)) apply(event.newValue);
  });
  customElements.define('appearance-picker', class extends HTMLElement {
    connectedCallback() {
      let button = this.querySelector('button');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-button';
        button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path/></svg>';
        button.addEventListener('click', () => {
          apply(modes[preference].next);
          try { localStorage.setItem(key, preference); } catch { /* Keep this window usable. */ }
        });
        this.append(button);
      }
      updateButton(button, preference);
    }
  });
})();

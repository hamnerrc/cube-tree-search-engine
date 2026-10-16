/**
 * A <select data-seg> shown as a strip of joined buttons, the
 * selected one pressed in. Used for the settings with two to four values.
 */
'use strict';

(function () {
  if (typeof document === 'undefined') return;
  const valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

  function enhance(sel) {
    if (sel.dataset.segDone) return;
    sel.dataset.segDone = '1';
    const strip = document.createElement('div');
    strip.className = 'seg-strip';
    strip.setAttribute('role', 'radiogroup');
    if (sel.getAttribute('aria-label')) strip.setAttribute('aria-label', sel.getAttribute('aria-label'));
    const buttons = [...sel.options].map((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = opt.dataset.short || opt.textContent;
      if (opt.dataset.short && opt.dataset.short !== opt.textContent) b.title = opt.textContent;
      b.addEventListener('click', () => {
        if (sel.value === opt.value) return;
        valueProp.set.call(sel, opt.value);
        sync();
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      strip.appendChild(b);
      return b;
    });
    function sync() {
      const v = valueProp.get.call(sel);
      [...sel.options].forEach((opt, i) => {
        const on = opt.value === v;
        buttons[i].setAttribute('aria-checked', String(on));
        buttons[i].tabIndex = on ? 0 : -1;
      });
    }
    strip.addEventListener('keydown', (e) => {
      if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      e.preventDefault();
      const i = sel.selectedIndex + (/Right|Down/.test(e.key) ? 1 : -1);
      const b = buttons[(i + buttons.length) % buttons.length];
      b.click();
      b.focus();
    });
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get() { return valueProp.get.call(this); },
      set(v) { valueProp.set.call(this, v); sync(); },
    });
    sel.addEventListener('change', sync);
    sel.hidden = true;
    sel.after(strip);
    sync();
  }

  function run() { document.querySelectorAll('select[data-seg]').forEach(enhance); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

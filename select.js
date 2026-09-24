'use strict';

/**
 * Lightweight shadcn-style Select for vanilla JS.
 * Structure mirrors shadcn: Trigger (value + chevron) -> Content (items with check).
 *
 * Usage:
 *   const sel = createSelect({
 *     items: [{ value: 'ai', label: 'AI (semantic)' }, ...],
 *     value: 'ai',
 *     onChange: (v) => {...},
 *     ariaLabel: 'Search mode'
 *   });
 *   container.appendChild(sel.el);
 *   sel.getValue(); sel.setValue('keyword');
 */
(function () {
  let openInstance = null; // only one open at a time

  function createSelect(opts) {
    const items = opts.items || [];
    let value = opts.value != null ? opts.value : (items[0] && items[0].value);
    const onChange = opts.onChange || function () {};

    const root = document.createElement('div');
    root.className = 'ui-select';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ui-select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (opts.ariaLabel) trigger.setAttribute('aria-label', opts.ariaLabel);

    const valueEl = document.createElement('span');
    valueEl.className = 'ui-select-value';

    const chevron = document.createElement('span');
    chevron.className = 'ui-select-chevron';
    chevron.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

    trigger.appendChild(valueEl);
    trigger.appendChild(chevron);

    const content = document.createElement('div');
    content.className = 'ui-select-content';
    content.setAttribute('role', 'listbox');
    content.hidden = true;

    const itemEls = [];
    let activeIndex = -1;

    items.forEach((it, idx) => {
      const item = document.createElement('div');
      item.className = 'ui-select-item';
      item.setAttribute('role', 'option');
      item.dataset.value = it.value;
      item.innerHTML =
        '<span class="ui-select-check">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
        '</span>' +
        '<span class="ui-select-item-label"></span>';
      item.querySelector('.ui-select-item-label').textContent = it.label;
      item.addEventListener('click', () => { select(idx); close(); trigger.focus(); });
      item.addEventListener('mousemove', () => setActive(idx));
      content.appendChild(item);
      itemEls.push(item);
    });

    function labelFor(v) {
      const found = items.find((i) => i.value === v);
      return found ? found.label : '';
    }

    function syncSelected() {
      valueEl.textContent = labelFor(value);
      itemEls.forEach((el) => {
        const sel = el.dataset.value === value;
        el.setAttribute('aria-selected', sel ? 'true' : 'false');
        el.classList.toggle('selected', sel);
      });
    }

    function setActive(idx) {
      activeIndex = idx;
      itemEls.forEach((el, i) => el.classList.toggle('active', i === idx));
      if (itemEls[idx]) itemEls[idx].scrollIntoView({ block: 'nearest' });
    }

    function select(idx) {
      const it = items[idx];
      if (!it) return;
      if (it.value !== value) {
        value = it.value;
        syncSelected();
        onChange(value);
      }
    }

    function open() {
      if (openInstance && openInstance !== api) openInstance.close();
      openInstance = api;
      content.hidden = false;
      root.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      const curIdx = items.findIndex((i) => i.value === value);
      setActive(curIdx >= 0 ? curIdx : 0);
      document.addEventListener('mousedown', onDocDown, true);
    }

    function close() {
      content.hidden = true;
      root.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocDown, true);
      if (openInstance === api) openInstance = null;
    }

    function toggle() { content.hidden ? open() : close(); }

    function onDocDown(e) {
      if (!root.contains(e.target)) close();
    }

    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (content.hidden) open(); else { select(activeIndex); close(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (content.hidden) open();
      } else if (e.key === 'Escape') {
        if (!content.hidden) { e.preventDefault(); close(); }
      }
    });

    content.addEventListener('keydown', () => {});

    // Keyboard nav while open: attach to root
    root.addEventListener('keydown', (e) => {
      if (content.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(itemEls.length - 1, activeIndex + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, activeIndex - 1)); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(itemEls.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(activeIndex); close(); trigger.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); trigger.focus(); }
    });

    root.appendChild(trigger);
    root.appendChild(content);
    syncSelected();

    const api = {
      el: root,
      getValue: () => value,
      setValue: (v) => { value = v; syncSelected(); },
      close
    };
    return api;
  }

  window.createSelect = createSelect;
})();

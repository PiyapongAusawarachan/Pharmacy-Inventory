// Turns every <select data-search> into a searchable list.
// The real <select> stays in the page (it still submits the form and fires "change"),
// so server code and other scripts keep working the same way.
(function () {
  var me = document.currentScript;
  var PLACEHOLDER = (me && me.getAttribute('data-ph')) || 'Type to search';
  var NONE = (me && me.getAttribute('data-none')) || 'No match';

  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  function enhance(select) {
    var wrap = document.createElement('div');
    wrap.className = 'combo';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'combo-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');
    input.autocomplete = 'off';
    input.placeholder = PLACEHOLDER;
    var list = document.createElement('ul');
    list.className = 'combo-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    var empty = document.createElement('li');
    empty.className = 'combo-none';
    empty.textContent = NONE;
    empty.hidden = true;

    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(input);
    wrap.appendChild(list);
    wrap.appendChild(select);
    select.classList.add('combo-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    var items = [];   // {li, text, opt}
    var heads = [];   // {li, items}
    function addOption(opt, group) {
      var li = document.createElement('li');
      li.className = 'combo-item' + (group ? ' in-group' : '');
      li.setAttribute('role', 'option');
      li.textContent = clean(opt.textContent);
      var it = { li: li, text: li.textContent.toLowerCase(), opt: opt };
      items.push(it);
      if (group) group.items.push(it);
      list.appendChild(li);
    }
    Array.prototype.forEach.call(select.children, function (child) {
      if (child.tagName === 'OPTGROUP') {
        var li = document.createElement('li');
        li.className = 'combo-group';
        li.textContent = child.label;
        list.appendChild(li);
        var g = { li: li, items: [] };
        heads.push(g);
        Array.prototype.forEach.call(child.children, function (o) { addOption(o, g); });
      } else addOption(child, null);
    });
    list.appendChild(empty);

    var active = -1;
    function visible() { return items.filter(function (it) { return !it.li.hidden; }); }
    function selectedText() {
      var o = select.options[select.selectedIndex];
      return o && o.value !== '' ? clean(o.textContent) : '';
    }
    function setActive(i) {
      var v = visible();
      v.forEach(function (it) { it.li.classList.remove('on'); });
      active = v.length ? Math.max(0, Math.min(i, v.length - 1)) : -1;
      if (active >= 0) { v[active].li.classList.add('on'); v[active].li.scrollIntoView({ block: 'nearest' }); }
    }
    function filter() {
      var q = input.value.trim().toLowerCase();
      var parts = q ? q.split(/\s+/) : [];
      items.forEach(function (it) {
        it.li.hidden = !parts.every(function (p) { return it.text.indexOf(p) !== -1; });
      });
      heads.forEach(function (g) { g.li.hidden = !g.items.some(function (it) { return !it.li.hidden; }); });
      empty.hidden = visible().length > 0;
      setActive(0);
    }
    function open() {
      if (!list.hidden) return;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.select();
      items.forEach(function (it) { it.li.hidden = false; it.li.classList.toggle('chosen', it.opt === select.options[select.selectedIndex]); });
      heads.forEach(function (g) { g.li.hidden = false; });
      empty.hidden = true;
      var chosen = items.filter(function (it) { return it.li.classList.contains('chosen'); })[0];
      setActive(chosen ? visible().indexOf(chosen) : 0);
    }
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.value = selectedText();
    }
    function choose(it) {
      select.value = it.opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    }

    input.value = selectedText();
    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    input.addEventListener('input', function () { if (list.hidden) { list.hidden = false; } filter(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); else setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { if (!list.hidden) { e.preventDefault(); var v = visible(); if (v[active]) choose(v[active]); } }
      else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); close(); } }
      else if (e.key === 'Tab') { close(); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    // mousedown (not click) so the input keeps focus until the choice is made
    list.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var li = e.target.closest('.combo-item');
      if (!li) return;
      items.forEach(function (it) { if (it.li === li) choose(it); });
    });
    // Keep the text in step if something else changes the select, or the form is reset.
    select.addEventListener('change', function () { if (list.hidden) input.value = selectedText(); });
    if (select.form) select.form.addEventListener('reset', function () { setTimeout(function () { input.value = selectedText(); }, 0); });
    // A required select that is still empty: show the browser message on the visible box.
    select.addEventListener('invalid', function () { input.focus(); });
  }

  document.querySelectorAll('select[data-search]').forEach(enhance);
})();

// Sale screen: search, cart, FEFO preview and a live allergy warning.
// This only helps the user; every rule is checked again on the server (src/routes/sales.js).
(function () {
  const data = JSON.parse(document.getElementById('sale-data').textContent);
  const S = data.strings;
  const byId = {};
  data.products.forEach(function (p) {
    p.available = p.lots.reduce(function (sum, l) { return sum + l.qty; }, 0);
    byId[p.medicine_id] = p;
  });
  const cart = data.cart.filter(function (i) { return byId[i.medicine_id]; })
    .map(function (i) { return { id: i.medicine_id, qty: i.quantity }; });

  const $ = function (id) { return document.getElementById(id); };
  const search = $('search');
  const results = $('results');
  const cartBody = $('cart');

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') node.className = props[k];
      else if (k === 'text') node.textContent = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  const money = function (n) { return '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const fill = function (text, value) { return text.replace('{0}', value); };
  const title = function (p) { return p.generic_name + ' ' + p.strength; };
  const legalClass = { HOUSEHOLD: 'tag tag-ok', PACKAGED_NON_DANGEROUS: 'tag', DANGEROUS: 'tag tag-warn', SPECIAL_CONTROLLED: 'tag tag-bad' };

  // Which lots a quantity would come from, first-expiring first (same order as the server).
  function plan(p, qty) {
    const parts = [];
    let need = qty;
    p.lots.forEach(function (l) {
      if (need <= 0) return;
      const take = Math.min(need, l.qty);
      parts.push({ no: l.no, exp: l.exp, take: take });
      need -= take;
    });
    return { parts: parts, short: Math.max(need, 0) };
  }

  function matches() {
    const patient = data.patients.find(function (x) { return x.code === $('patient').value; });
    if (!patient) return [];
    const found = [];
    cart.forEach(function (item) {
      const p = byId[item.id];
      const ingredients = p.generic_name.split('+');
      patient.allergies.forEach(function (a) {
        const hit = a.level === 'CLASS' ? a.code === p.drug_class : ingredients.indexOf(a.code) !== -1;
        if (hit) found.push({ medicine: title(p), display: a.display, exact: a.level === 'INGREDIENT' });
      });
    });
    return found;
  }

  function renderResults() {
    const q = search.value.trim().toLowerCase();
    results.textContent = '';
    if (!q) return;
    // Names that start with the typed text come first, then names that merely contain it.
    const rank = function (p) {
      const names = [p.generic_name, (p.brand_name || '').toLowerCase()];
      if (names.some(function (n) { return n.indexOf(q) === 0; })) return 0;
      return names.some(function (n) { return n.indexOf(q) !== -1; }) ? 1 : 2;
    };
    data.products
      .filter(function (p) { return rank(p) < 2; })
      .sort(function (a, b) { return rank(a) - rank(b); })
      .slice(0, 8)
      .forEach(function (p, i) {
        const btn = el('button', { type: 'button', class: 'result' + (i === 0 ? ' first' : ''), 'data-id': p.medicine_id }, [
          el('span', { class: 'name' }, [
            el('strong', { text: title(p) }),
            el('span', { class: 'muted small', text: '  ' + p.dosage_form + (p.brand_name ? ' · ' + p.brand_name : '') }),
          ]),
          el('span', { class: legalClass[p.legal_category], text: S.legal[p.legal_category] }),
          el('span', { class: p.available ? 'muted small' : 'tag tag-bad', text: p.available ? p.available + ' ' + p.base_unit + ' ' + S.inStock : S.outOfStock }),
          el('strong', { text: money(p.sell_price) }),
        ]);
        if (!p.available) btn.disabled = true;
        btn.addEventListener('click', function () { add(p.medicine_id); });
        results.appendChild(btn);
      });
  }

  function add(id) {
    const p = byId[id];
    const step = ['tablet', 'capsule'].indexOf(p.base_unit) !== -1 ? 10 : 1;
    const line = cart.find(function (i) { return i.id === id; });
    if (line) line.qty += step;
    else cart.push({ id: id, qty: Math.min(step, p.available) });
    search.value = '';
    renderResults();
    renderCart();
    search.focus();
  }

  function lotPills(p, qty) {
    const fefo = plan(p, qty);
    const box = el('div', { class: 'lot-pills' }, [el('span', { class: 'muted small', text: S.lots })]);
    fefo.parts.forEach(function (part) {
      box.appendChild(el('span', { class: 'tag tag-line mono', title: part.exp, text: part.no + ' × ' + part.take }));
    });
    if (fefo.short) box.appendChild(el('span', { class: 'tag tag-bad', text: fill(S.short, fefo.short) }));
    if (p.max_qty_per_sale && qty > p.max_qty_per_sale) box.appendChild(el('span', { class: 'tag tag-bad', text: fill(S.maxPerSale, p.max_qty_per_sale) }));
    return box;
  }

  function renderCart() {
    cartBody.textContent = '';
    cart.forEach(function (item, index) {
      const p = byId[item.id];
      const qty = el('input', { type: 'number', class: 'qty', name: 'quantity[]', min: '1', step: '1', value: item.qty, 'aria-label': title(p) });
      const pills = el('div', {}, [lotPills(p, item.qty)]);
      const lineTotal = el('td', { class: 'num', text: money(item.qty * p.sell_price) });
      qty.addEventListener('input', function () {
        item.qty = Math.max(parseInt(qty.value, 10) || 0, 0);
        pills.textContent = '';
        pills.appendChild(lotPills(p, item.qty));
        lineTotal.textContent = money(item.qty * p.sell_price);
        renderSummary();
      });
      const remove = el('button', { type: 'button', class: 'btn btn-small', text: S.remove });
      remove.addEventListener('click', function () { cart.splice(index, 1); renderCart(); });
      cartBody.appendChild(el('tr', {}, [
        el('td', {}, [
          el('input', { type: 'hidden', name: 'medicine_id[]', value: item.id }),
          el('strong', { text: title(p) }),
          el('span', { text: ' ' }),
          el('span', { class: legalClass[p.legal_category], text: S.legal[p.legal_category] }),
          pills,
        ]),
        el('td', { class: 'num' }, [qty, el('div', { class: 'muted small', text: p.base_unit })]),
        el('td', { class: 'num', text: money(p.sell_price) }),
        lineTotal,
        el('td', { class: 'num' }, [remove]),
      ]));
    });
    renderSummary();
  }

  function renderSummary() {
    const items = cart.map(function (i) { return byId[i.id]; });
    const total = cart.reduce(function (sum, i) { return sum + i.qty * byId[i.id].sell_price; }, 0);
    $('total').textContent = money(total);

    const notes = $('notes');
    notes.textContent = '';
    const restricted = items.some(function (p) { return p.legal_category === 'DANGEROUS' || p.legal_category === 'SPECIAL_CONTROLLED'; });
    if (restricted) notes.appendChild(el('p', { class: data.role === 'PHARMACIST' ? 'note' : 'flash flash-error', text: S.pharmacistOnly }));
    const needsName = items.some(function (p) { return p.requires_khy11 || p.requires_prescription; });
    if (needsName && !$('customer-name').value.trim()) notes.appendChild(el('p', { class: 'flash flash-info', text: S.nameNeeded }));
    $('rx-wrap').hidden = !items.some(function (p) { return p.requires_prescription; });

    const found = matches();
    const box = $('allergy-box');
    box.hidden = !found.length;
    if (found.length) {
      const exact = found.some(function (m) { return m.exact; });
      box.className = exact ? 'stop' : 'stop caution';
      $('allergy-title').textContent = exact ? S.stopTitle : S.cautionTitle;
      const list = $('allergy-list');
      list.textContent = '';
      found.forEach(function (m) {
        list.appendChild(el('li', {}, [el('strong', { text: m.medicine }), el('span', { text: ' — ' + m.display + ' (' + (m.exact ? S.exact : S.sameClass) + ')' })]));
      });
      $('ack-wrap').hidden = exact;
    }
    $('submit').disabled = !cart.length;
  }

  function renderPatient() {
    const patient = data.patients.find(function (x) { return x.code === $('patient').value; });
    const box = $('patient-allergies');
    box.textContent = '';
    if (!patient) box.appendChild(el('span', { class: 'muted small', text: S.walkIn }));
    else if (!patient.allergies.length) box.appendChild(el('span', { class: 'tag tag-ok', text: S.noAllergy }));
    else patient.allergies.forEach(function (a) { box.appendChild(el('span', { class: 'tag tag-bad', text: a.display })); });
    if (patient && !$('customer-name').value.trim()) $('customer-name').value = patient.name;
    renderSummary();
  }

  search.addEventListener('input', renderResults);
  search.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = results.querySelector('.result:not([disabled])');
    if (first) add(Number(first.getAttribute('data-id')));
  });
  $('patient').addEventListener('change', renderPatient);
  $('customer-name').addEventListener('input', renderSummary);
  $('sale-form').addEventListener('keydown', function (e) {
    if (e.key === 'F2') { e.preventDefault(); search.focus(); }
  });

  renderCart();
  renderPatient();
})();

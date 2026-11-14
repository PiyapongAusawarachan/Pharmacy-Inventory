const express = require('express');
const { pool } = require('../db/pg');
const config = require('../config');
const { LOT_STATUSES } = require('../config/contract');
const { requireRole, flash } = require('../middleware/auth');
const wrap = require('../utils/asyncHandler');
const { friendlyDbError } = require('../utils/dbErrors');
const { audit } = require('../services/audit');

// Mounted at /lots (login required). Everyone can view; ADMIN and PHARMACIST can change.
const router = express.Router();
const WRITE = requireRole('ADMIN', 'PHARMACIST');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function formChoices() {
  const [meds, sups] = await Promise.all([
    pool.query(
      `SELECT medicine_id, generic_name, brand_name, strength, dosage_form, base_unit, units_per_pack
       FROM medicines WHERE is_active ORDER BY generic_name, brand_name`
    ),
    pool.query('SELECT supplier_id, name FROM suppliers WHERE is_active ORDER BY name'),
  ]);
  return { medicines: meds.rows, suppliers: sups.rows };
}

router.get(
  '/',
  wrap(async (req, res) => {
    const where = [];
    const params = [];
    const filters = { medicine: '', status: '', view: '' };

    if (/^\d+$/.test(String(req.query.medicine || ''))) {
      params.push(Number(req.query.medicine));
      where.push(`l.medicine_id = $${params.length}`);
      filters.medicine = req.query.medicine;
    }
    if (LOT_STATUSES.includes(req.query.status)) {
      params.push(req.query.status);
      where.push(`l.status = $${params.length}`);
      filters.status = req.query.status;
    }
    if (req.query.view === 'near') {
      params.push(config.nearExpiryDays);
      where.push(`l.expiry_date > CURRENT_DATE AND l.expiry_date <= CURRENT_DATE + $${params.length}::int`);
      filters.view = 'near';
    } else if (req.query.view === 'expired') {
      where.push('l.expiry_date <= CURRENT_DATE');
      filters.view = 'expired';
    }

    const { rows } = await pool.query(
      `SELECT l.*, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.base_unit,
              s.name AS supplier_name, (l.expiry_date - CURRENT_DATE) AS days_left
       FROM stock_lots l
       JOIN medicines m ON m.medicine_id = l.medicine_id
       JOIN suppliers s ON s.supplier_id = l.supplier_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY l.expiry_date, l.lot_id`,
      params
    );
    const meds = await pool.query('SELECT medicine_id, generic_name, brand_name, strength FROM medicines ORDER BY generic_name, brand_name');
    res.render('lots/list', { title: 'Stock lots', rows, filters, medicines: meds.rows });
  })
);

router.get(
  '/new',
  WRITE,
  wrap(async (req, res) => {
    const choices = await formChoices();
    const today = new Date().toISOString().slice(0, 10);
    res.render('lots/form', {
      title: 'Receive stock lot',
      mode: 'new',
      lot: {
        medicine_id: /^\d+$/.test(String(req.query.medicine || '')) ? Number(req.query.medicine) : '',
        supplier_id: '',
        lot_number: '',
        mfg_date: '',
        expiry_date: '',
        received_date: today,
        packs: 1,
        unit_cost: 0,
      },
      errors: [],
      ...choices,
    });
  })
);

router.post(
  '/',
  WRITE,
  wrap(async (req, res) => {
    const b = req.body;
    const v = {
      medicine_id: Number(b.medicine_id),
      supplier_id: Number(b.supplier_id),
      lot_number: String(b.lot_number || '').trim(),
      mfg_date: String(b.mfg_date || '').trim() || null,
      expiry_date: String(b.expiry_date || '').trim(),
      received_date: String(b.received_date || '').trim() || null,
      packs: Number(b.packs),
      unit_cost: b.unit_cost === undefined || b.unit_cost === '' ? 0 : Number(b.unit_cost),
    };

    const choices = await formChoices();
    const med = choices.medicines.find((m) => m.medicine_id === v.medicine_id);

    const errors = [];
    if (!med) errors.push('Pick an active medicine.');
    if (!choices.suppliers.some((s) => s.supplier_id === v.supplier_id)) errors.push('Pick an active supplier.');
    if (!v.lot_number) errors.push('Lot number is required.');
    if (v.lot_number.length > 50) errors.push('Lot number is too long (max 50 characters).');
    if (!DATE_RE.test(v.expiry_date)) errors.push('Expiry date is required.');
    if (v.mfg_date && !DATE_RE.test(v.mfg_date)) errors.push('Manufacture date is not a valid date.');
    if (v.received_date && !DATE_RE.test(v.received_date)) errors.push('Received date is not a valid date.');
    if (!Number.isInteger(v.packs) || v.packs < 1) errors.push('Packs received must be a whole number of 1 or more.');
    if (!(v.unit_cost >= 0)) errors.push('Unit cost must be a number of 0 or more.');

    const render = (errs) =>
      res.status(400).render('lots/form', { title: 'Receive stock lot', mode: 'new', lot: v, errors: errs, ...choices });
    if (errors.length) return render(errors);

    // Stock is always stored in the base unit: packs x units per pack.
    const qty = v.packs * med.units_per_pack;
    try {
      const { rows } = await pool.query(
        `INSERT INTO stock_lots
           (medicine_id, supplier_id, lot_number, mfg_date, expiry_date, received_date,
            qty_received, qty_on_hand, unit_cost)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$7,$8) RETURNING lot_id`,
        [v.medicine_id, v.supplier_id, v.lot_number, v.mfg_date, v.expiry_date, v.received_date, qty, v.unit_cost]
      );
      audit('LOT_CREATED', 'stock_lots', rows[0].lot_id, req.session.user.staff_id, {
        medicine_id: v.medicine_id,
        lot_number: v.lot_number,
        qty_received: qty,
        expiry_date: v.expiry_date,
      });
      flash(req, 'success', `Lot ${v.lot_number} received: ${qty} ${med.base_unit}(s) of ${med.generic_name}.`);
      res.redirect('/lots');
    } catch (err) {
      const msg = friendlyDbError(err);
      if (!msg) throw err;
      render([msg]);
    }
  })
);

async function loadLot(id) {
  if (!id) return null;
  const { rows } = await pool.query(
    `SELECT l.*, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.base_unit
     FROM stock_lots l JOIN medicines m ON m.medicine_id = l.medicine_id
     WHERE l.lot_id = $1`,
    [id]
  );
  return rows[0] || null;
}

router.get(
  '/:id/edit',
  WRITE,
  wrap(async (req, res, next) => {
    const lot = await loadLot(parseId(req));
    if (!lot) return next();
    const sups = await pool.query('SELECT supplier_id, name FROM suppliers WHERE is_active OR supplier_id = $1 ORDER BY name', [lot.supplier_id]);
    res.render('lots/form', { title: 'Edit stock lot', mode: 'edit', lot, errors: [], suppliers: sups.rows, medicines: [] });
  })
);

// Medicine and quantity received are fixed after receiving. Quantity on hand can be
// corrected (stock adjustment) and the status changed (e.g. QUARANTINED, RECALLED).
router.post(
  '/:id',
  WRITE,
  wrap(async (req, res, next) => {
    const id = parseId(req);
    const old = await loadLot(id);
    if (!old) return next();

    const b = req.body;
    const v = {
      supplier_id: Number(b.supplier_id),
      lot_number: String(b.lot_number || '').trim(),
      mfg_date: String(b.mfg_date || '').trim() || null,
      expiry_date: String(b.expiry_date || '').trim(),
      unit_cost: b.unit_cost === undefined || b.unit_cost === '' ? 0 : Number(b.unit_cost),
      status: b.status,
      qty_on_hand: Number(b.qty_on_hand),
    };

    const sups = await pool.query('SELECT supplier_id, name FROM suppliers WHERE is_active OR supplier_id = $1 ORDER BY name', [old.supplier_id]);
    const errors = [];
    if (!sups.rows.some((s) => s.supplier_id === v.supplier_id)) errors.push('Pick a supplier.');
    if (!v.lot_number) errors.push('Lot number is required.');
    if (v.lot_number.length > 50) errors.push('Lot number is too long (max 50 characters).');
    if (!DATE_RE.test(v.expiry_date)) errors.push('Expiry date is required.');
    if (v.mfg_date && !DATE_RE.test(v.mfg_date)) errors.push('Manufacture date is not a valid date.');
    if (!(v.unit_cost >= 0)) errors.push('Unit cost must be a number of 0 or more.');
    if (!LOT_STATUSES.includes(v.status)) errors.push('Pick a status.');
    if (!Number.isInteger(v.qty_on_hand) || v.qty_on_hand < 0) errors.push('Quantity on hand must be a whole number of 0 or more.');

    const render = (errs) =>
      res.status(400).render('lots/form', {
        title: 'Edit stock lot',
        mode: 'edit',
        lot: { ...old, ...v },
        errors: errs,
        suppliers: sups.rows,
        medicines: [],
      });
    if (errors.length) return render(errors);

    try {
      await pool.query(
        `UPDATE stock_lots SET supplier_id=$1, lot_number=$2, mfg_date=$3, expiry_date=$4,
           unit_cost=$5, status=$6, qty_on_hand=$7 WHERE lot_id=$8`,
        [v.supplier_id, v.lot_number, v.mfg_date, v.expiry_date, v.unit_cost, v.status, v.qty_on_hand, id]
      );
      audit('LOT_UPDATED', 'stock_lots', id, req.session.user.staff_id, {
        before: { qty_on_hand: old.qty_on_hand, status: old.status, expiry_date: old.expiry_date },
        after: { qty_on_hand: v.qty_on_hand, status: v.status, expiry_date: v.expiry_date },
      });
      flash(req, 'success', 'Lot updated.');
      res.redirect('/lots');
    } catch (err) {
      const msg = friendlyDbError(err);
      if (!msg) throw err;
      render([msg]);
    }
  })
);

// A lot that has been sold from cannot be deleted (foreign key). Change its status instead.
router.post(
  '/:id/delete',
  WRITE,
  wrap(async (req, res, next) => {
    const id = parseId(req);
    if (!id) return next();
    try {
      const r = await pool.query('DELETE FROM stock_lots WHERE lot_id = $1', [id]);
      if (!r.rowCount) return next();
      audit('LOT_DELETED', 'stock_lots', id, req.session.user.staff_id);
      flash(req, 'success', 'Lot deleted.');
    } catch (err) {
      if (err.code !== '23503') throw err;
      flash(
        req,
        'error',
        'This lot has sales history and cannot be deleted. Edit it and set the status to QUARANTINED, EXPIRED or RECALLED instead.'
      );
    }
    res.redirect('/lots');
  })
);

module.exports = router;

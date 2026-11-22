const express = require('express');
const { pool } = require('../connections/pg');
const { getDb } = require('../connections/mongo');
const wrap = require('../utils/asyncHandler');
const { requireRole, flash } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { matchAllergies } = require('../services/allergy');
const { createSale, cancelSale, SaleError } = require('../services/sale');
const { checkLowStockAfterSale, notify } = require('../services/alerts');

const router = express.Router();
const RESTRICTED = ['DANGEROUS', 'SPECIAL_CONTROLLED'];

// Everything the sale screen needs: sellable products with their FEFO lots, and patients.
async function loadFormData() {
  const { rows: products } = await pool.query(
    `SELECT m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.drug_class,
            m.legal_category, m.requires_prescription, m.requires_khy11, m.base_unit, m.sell_price,
            m.max_qty_per_sale, m.warnings,
            COALESCE(json_agg(json_build_object('no', l.lot_number, 'exp', l.expiry_date, 'qty', l.qty_on_hand)
                              ORDER BY l.expiry_date, l.received_date, l.lot_id)
                     FILTER (WHERE l.lot_id IS NOT NULL), '[]') AS lots
       FROM medicines m
       LEFT JOIN stock_lots l ON l.medicine_id = m.medicine_id AND l.status = 'ACTIVE'
            AND l.qty_on_hand > 0 AND l.expiry_date > CURRENT_DATE
      WHERE m.is_active
      GROUP BY m.medicine_id
      ORDER BY m.generic_name, m.brand_name NULLS FIRST, m.strength`
  );
  const patients = await getDb()
    .collection('patient_notes')
    .find({})
    .sort({ patient_code: 1 })
    .toArray();
  return {
    products: products.map((p) => ({ ...p, sell_price: Number(p.sell_price) })),
    patients: patients.map((p) => ({
      code: p.patient_code,
      name: p.name,
      allergies: (p.allergies || [])
        .filter((a) => a.verification_status !== 'REFUTED')
        .map((a) => ({ level: a.allergen.level, code: a.allergen.code, display: a.allergen.display })),
    })),
  };
}

async function renderForm(req, res, status, state) {
  const data = await loadFormData();
  res.locals.currentPath = '/sales/new'; // keep "New sale" highlighted when the form is shown again after an error
  res.status(status).render('sales/form', {
    title: 'New sale',
    errors: state.errors || [],
    form: {
      patient_code: state.patient_code || '',
      customer_name: state.customer_name || '',
      override_reason: state.override_reason || '',
      ack_class: !!state.ack_class,
      rx_confirmed: !!state.rx_confirmed,
    },
    saleData: { ...data, cart: state.items || [] },
  });
}

router.get(
  '/',
  wrap(async (req, res) => {
    const status = ['COMPLETED', 'CANCELLED'].includes(req.query.status) ? req.query.status : '';
    const { rows } = await pool.query(
      `SELECT s.sale_id, s.sale_datetime, s.patient_code, s.customer_name, s.total_amount, s.status,
              s.override_reason, st.full_name AS staff_name,
              (SELECT COUNT(DISTINCT medicine_id) FROM sale_items i WHERE i.sale_id = s.sale_id)::int AS item_count
         FROM sales s JOIN staff st ON st.staff_id = s.staff_id
        WHERE ($1 = '' OR s.status::text = $1)
        ORDER BY s.sale_datetime DESC LIMIT 200`,
      [status]
    );
    res.render('sales/list', { title: 'Sales history', rows, status });
  })
);

router.get('/new', wrap(async (req, res) => renderForm(req, res, 200, { patient_code: req.query.patient || '' })));

router.post(
  '/',
  wrap(async (req, res) => {
    const user = req.session.user;
    const t = req.t;
    const ids = [].concat(req.body.medicine_id || []);
    const qtys = [].concat(req.body.quantity || []);
    const state = {
      patient_code: String(req.body.patient_code || '').trim(),
      customer_name: String(req.body.customer_name || '').trim(),
      override_reason: String(req.body.override_reason || '').trim(),
      ack_class: req.body.ack_class === 'on',
      rx_confirmed: req.body.rx_confirmed === 'on',
      items: [],
      errors: [],
    };
    const errors = state.errors;

    // Merge repeated medicines into one line each.
    const merged = new Map();
    ids.forEach((raw, i) => {
      const id = Number(raw);
      const qty = Number(qtys[i]);
      if (!Number.isInteger(id)) return;
      if (!Number.isInteger(qty) || qty < 1) {
        errors.push(t('Quantity must be a whole number of 1 or more.'));
        return;
      }
      merged.set(id, (merged.get(id) || 0) + qty);
    });
    state.items = [...merged].map(([medicine_id, quantity]) => ({ medicine_id, quantity }));
    if (!state.items.length && !errors.length) errors.push(t('Add at least one medicine to the bill.'));

    const { rows: meds } = await pool.query(
      'SELECT * FROM medicines WHERE medicine_id = ANY($1::int[]) AND is_active',
      [state.items.map((i) => i.medicine_id)]
    );
    const byId = new Map(meds.map((m) => [m.medicine_id, m]));
    const label = (m) => `${m.generic_name} ${m.strength}`;
    if (state.items.some((i) => !byId.has(i.medicine_id))) errors.push(t('One of the medicines is no longer available.'));

    // Who may sell what (Thai Drug Act categories).
    const restricted = meds.filter((m) => RESTRICTED.includes(m.legal_category));
    if (restricted.length && user.role !== 'PHARMACIST') {
      errors.push(t('Only the pharmacist on duty can sell dangerous or specially controlled drugs: {0}.', restricted.map(label).join(', ')));
    }
    const needsName = meds.filter((m) => m.requires_khy11 || m.requires_prescription);
    if (needsName.length && !state.customer_name) {
      errors.push(t('Customer name is required for the sales ledger when selling: {0}.', needsName.map(label).join(', ')));
    }
    const rx = meds.filter((m) => m.requires_prescription);
    if (rx.length && !state.rx_confirmed) {
      errors.push(t('Confirm that you have seen the prescription for: {0}.', rx.map(label).join(', ')));
    }
    state.items.forEach((i) => {
      const m = byId.get(i.medicine_id);
      if (m && m.max_qty_per_sale && i.quantity > m.max_qty_per_sale) {
        errors.push(t('{0}: at most {1} {2} per sale.', label(m), m.max_qty_per_sale, m.base_unit));
      }
    });

    // Allergy check against the patient's record in MongoDB, before any stock is touched.
    let matches = [];
    if (state.patient_code) {
      const patient = await getDb().collection('patient_notes').findOne({ patient_code: state.patient_code });
      if (!patient) errors.push(t('Patient not found.'));
      else matches = meds.flatMap((m) => matchAllergies(patient.allergies, m));
    }
    if (matches.length) {
      const exact = matches.some((m) => m.level === 'INGREDIENT');
      if (user.role !== 'PHARMACIST') {
        errors.push(t('Allergy warning: only a pharmacist can decide to continue this sale.'));
      } else if (exact && state.override_reason.length < 5) {
        errors.push(t('Allergy warning: remove the medicine, or type a reason to continue (at least 5 characters).'));
      } else if (!exact && !state.ack_class && state.override_reason.length < 5) {
        errors.push(t('Allergy warning: remove the medicine, or tick the box to confirm you reviewed it.'));
      }
    }
    if (errors.length) return renderForm(req, res, 400, state);

    const overrideReason = matches.length ? state.override_reason || 'Same-class warning reviewed by pharmacist' : null;
    let result;
    try {
      result = await createSale({
        staffId: user.staff_id,
        patientCode: state.patient_code,
        customerName: state.customer_name,
        overrideReason,
        items: state.items,
      });
    } catch (err) {
      if (!(err instanceof SaleError)) throw err;
      // The SQL transaction was rolled back. Record that in MongoDB so the failure is traceable.
      await audit('SALE_ROLLED_BACK', 'sales', null, user.staff_id, {
        reason: err.code, ...err.details, items: state.items, patient_code: state.patient_code || null,
      });
      const d = err.details;
      errors.push(
        err.code === 'INSUFFICIENT_STOCK'
          ? t('Not enough stock for {0}: requested {1}, available {2}. The whole bill was rolled back and no stock was deducted.', d.medicine, d.requested, d.available)
          : t('One of the medicines is no longer available.')
      );
      return renderForm(req, res, 409, state);
    }

    // SQL is committed. MongoDB writes come after; if one fails the sale still stands (see README).
    await audit('SALE_COMMITTED', 'sales', result.sale_id, user.staff_id, {
      total: result.total, patient_code: state.patient_code || null,
      lines: result.lines.map((l) => ({ medicine_id: l.medicine_id, lot_id: l.lot_id, lot_number: l.lot_number, quantity: l.quantity })),
    });
    try {
      await notify({
        role: 'PHARMACIST',
        message: `Sale #${result.sale_id} completed: ฿${result.total.toFixed(2)}`,
        ref: { type: 'sales', id: result.sale_id },
      });
    } catch (err) {
      console.error('sale notification failed:', err.message);
    }
    if (matches.length) {
      await audit('ALLERGY_OVERRIDE', 'sales', result.sale_id, user.staff_id, {
        patient_code: state.patient_code, reason: overrideReason,
        matches: matches.map((m) => ({ level: m.level, code: m.code, medicine_id: m.medicine_id })),
      });
    }
    try {
      await checkLowStockAfterSale(state.items.map((i) => i.medicine_id), t);
    } catch (err) {
      console.error('stock alert check failed:', err.message);
    }

    flash(req, 'success', t('Sale #{0} saved. Stock was deducted first-expiry-first.', result.sale_id));
    res.redirect(`/sales/${result.sale_id}`);
  })
);

router.get(
  '/:id',
  wrap(async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return next();
    const { rows } = await pool.query(
      `SELECT s.*, st.full_name AS staff_name, c.full_name AS cancelled_by_name
         FROM sales s JOIN staff st ON st.staff_id = s.staff_id
         LEFT JOIN staff c ON c.staff_id = s.cancelled_by
        WHERE s.sale_id = $1`,
      [id]
    );
    if (!rows[0]) return next();
    const { rows: items } = await pool.query(
      `SELECT i.quantity, i.unit_price, (i.quantity * i.unit_price) AS line_total,
              m.medicine_id, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.base_unit,
              m.legal_category, m.requires_khy11, m.indication, m.warnings, m.max_daily_dose,
              l.lot_number, l.expiry_date
         FROM sale_items i
         JOIN medicines m ON m.medicine_id = i.medicine_id
         JOIN stock_lots l ON l.lot_id = i.lot_id
        WHERE i.sale_id = $1
        ORDER BY m.generic_name, l.expiry_date`,
      [id]
    );
    let patient = null;
    if (rows[0].patient_code) {
      patient = await getDb().collection('patient_notes').findOne({ patient_code: rows[0].patient_code });
    }
    res.render('sales/detail', { title: 'Sale', sale: rows[0], items, patient });
  })
);

router.post(
  '/:id/cancel',
  requireRole('ADMIN', 'PHARMACIST'),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    try {
      const result = await cancelSale(id, req.session.user.staff_id);
      await audit('SALE_CANCELLED', 'sales', id, req.session.user.staff_id, {
        returned: result.items.map((i) => ({ lot_id: i.lot_id, medicine_id: i.medicine_id, quantity: i.quantity })),
      });
      flash(req, 'success', req.t('Sale #{0} was cancelled and the stock went back to its original lots.', id));
    } catch (err) {
      if (err instanceof SaleError) {
        flash(req, 'error', req.t(err.code === 'ALREADY_CANCELLED' ? 'This sale was already cancelled.' : 'Sale not found.'));
      } else if (err.constraint === 'chk_stock_lots_qty_on_hand') {
        flash(req, 'error', req.t('Cannot cancel: a lot was adjusted after this sale, so the stock cannot be returned. Nothing was changed.'));
      } else throw err;
    }
    res.redirect(`/sales/${id}`);
  })
);

module.exports = router;

const express = require('express');
const { pool } = require('../db/pg');
const { requireRole, flash } = require('../middleware/auth');
const wrap = require('../utils/asyncHandler');
const { friendlyDbError } = require('../utils/dbErrors');
const { audit } = require('../services/audit');

// Mounted at /suppliers (login required). Everyone can view; ADMIN and PHARMACIST can change.
const router = express.Router();
const WRITE = requireRole('ADMIN', 'PHARMACIST');

function parseSupplier(body, { creating }) {
  const v = {
    name: String(body.name || '').trim(),
    phone: String(body.phone || '').trim() || null,
    address: String(body.address || '').trim() || null,
    is_active: creating ? true : body.is_active === 'on',
  };
  const errors = [];
  if (!v.name) errors.push('Supplier name is required.');
  if (v.name.length > 150) errors.push('Supplier name is too long (max 150 characters).');
  if (v.phone && v.phone.length > 30) errors.push('Phone is too long (max 30 characters).');
  return { v, errors };
}

function parseId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT s.*, (SELECT COUNT(*) FROM stock_lots l WHERE l.supplier_id = s.supplier_id)::int AS lot_count
       FROM suppliers s ORDER BY s.is_active DESC, s.name`
    );
    res.render('suppliers/list', { title: 'Suppliers', rows });
  })
);

router.get('/new', WRITE, (req, res) => {
  res.render('suppliers/form', {
    title: 'Add supplier',
    mode: 'new',
    s: { name: '', phone: '', address: '', is_active: true },
    errors: [],
  });
});

router.post(
  '/',
  WRITE,
  wrap(async (req, res) => {
    const { v, errors } = parseSupplier(req.body, { creating: true });
    const render = (errs) =>
      res.status(400).render('suppliers/form', { title: 'Add supplier', mode: 'new', s: v, errors: errs });
    if (errors.length) return render(errors);

    try {
      const { rows } = await pool.query(
        'INSERT INTO suppliers (name, phone, address) VALUES ($1, $2, $3) RETURNING supplier_id',
        [v.name, v.phone, v.address]
      );
      audit('SUPPLIER_CREATED', 'suppliers', rows[0].supplier_id, req.session.user.staff_id, { name: v.name });
      flash(req, 'success', `Supplier "${v.name}" was added.`);
      res.redirect('/suppliers');
    } catch (err) {
      const msg = friendlyDbError(err);
      if (!msg) throw err;
      render([msg]);
    }
  })
);

router.get(
  '/:id/edit',
  WRITE,
  wrap(async (req, res, next) => {
    const id = parseId(req);
    const { rows } = id ? await pool.query('SELECT * FROM suppliers WHERE supplier_id = $1', [id]) : { rows: [] };
    if (!rows[0]) return next();
    res.render('suppliers/form', { title: 'Edit supplier', mode: 'edit', s: rows[0], errors: [] });
  })
);

router.post(
  '/:id',
  WRITE,
  wrap(async (req, res, next) => {
    const id = parseId(req);
    const found = id ? await pool.query('SELECT 1 FROM suppliers WHERE supplier_id = $1', [id]) : { rows: [] };
    if (!found.rows[0]) return next();

    const { v, errors } = parseSupplier(req.body, { creating: false });
    const render = (errs) =>
      res
        .status(400)
        .render('suppliers/form', { title: 'Edit supplier', mode: 'edit', s: { ...v, supplier_id: id }, errors: errs });
    if (errors.length) return render(errors);

    try {
      await pool.query('UPDATE suppliers SET name=$1, phone=$2, address=$3, is_active=$4 WHERE supplier_id=$5', [
        v.name,
        v.phone,
        v.address,
        v.is_active,
        id,
      ]);
      audit('SUPPLIER_UPDATED', 'suppliers', id, req.session.user.staff_id, { name: v.name, is_active: v.is_active });
      flash(req, 'success', 'Supplier updated.');
      res.redirect('/suppliers');
    } catch (err) {
      const msg = friendlyDbError(err);
      if (!msg) throw err;
      render([msg]);
    }
  })
);

// Delete when possible; a supplier that has delivered lots is deactivated instead.
router.post(
  '/:id/delete',
  WRITE,
  wrap(async (req, res, next) => {
    const id = parseId(req);
    if (!id) return next();
    try {
      const r = await pool.query('DELETE FROM suppliers WHERE supplier_id = $1', [id]);
      if (!r.rowCount) return next();
      audit('SUPPLIER_DELETED', 'suppliers', id, req.session.user.staff_id);
      flash(req, 'success', 'Supplier deleted.');
    } catch (err) {
      if (err.code !== '23503') throw err;
      await pool.query('UPDATE suppliers SET is_active = FALSE WHERE supplier_id = $1', [id]);
      audit('SUPPLIER_DEACTIVATED', 'suppliers', id, req.session.user.staff_id);
      flash(req, 'info', 'This supplier has delivered stock lots, so it was deactivated instead of deleted.');
    }
    res.redirect('/suppliers');
  })
);

module.exports = router;

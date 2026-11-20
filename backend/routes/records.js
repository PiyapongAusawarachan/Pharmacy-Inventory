// Record pages: stock alerts, notifications and the audit log (MongoDB), plus the ขย. ledgers (SQL).
const express = require('express');
const { ObjectId } = require('mongodb');
const { pool } = require('../connections/pg');
const { getDb } = require('../connections/mongo');
const wrap = require('../utils/asyncHandler');
const { requireRole, flash } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { scanStock, notify } = require('../services/alerts');
const { STAFF_ROLES } = require('../config/contract');

const router = express.Router();
const canEdit = requireRole('ADMIN', 'PHARMACIST');
const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

// ---------- Stock alerts ----------
router.get(
  '/alerts',
  wrap(async (req, res) => {
    const status = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(req.query.status) ? req.query.status : '';
    const alerts = await getDb().collection('stock_alerts')
      .find(status ? { status } : {}).sort({ created_at: -1 }).limit(300).toArray();
    // Names come from PostgreSQL; the alert only stores ids.
    const ids = [...new Set(alerts.map((a) => a.medicine_id))];
    const { rows: meds } = await pool.query(
      'SELECT medicine_id, generic_name, strength, base_unit FROM medicines WHERE medicine_id = ANY($1::int[])', [ids]);
    const lotIds = [...new Set(alerts.map((a) => a.lot_id).filter(Boolean))];
    const { rows: lots } = await pool.query('SELECT lot_id, lot_number FROM stock_lots WHERE lot_id = ANY($1::int[])', [lotIds]);
    const medById = new Map(meds.map((m) => [m.medicine_id, m]));
    const lotById = new Map(lots.map((l) => [l.lot_id, l.lot_number]));
    const rows = alerts.map((a) => ({ ...a, med: medById.get(a.medicine_id) || null, lot_number: lotById.get(a.lot_id) || null }));
    res.render('records/alerts', { title: 'Stock alerts', rows, status });
  })
);

router.post(
  '/alerts/scan',
  wrap(async (req, res) => {
    const created = await scanStock();
    if (created) {
      await notify({ role: 'PHARMACIST', message: req.t('Stock scan found {0} new alert(s).', created), ref: { type: 'stock_alerts', id: 'SCAN' } });
    }
    audit('STOCK_SCANNED', 'stock_alerts', null, req.session.user.staff_id, { created });
    flash(req, created ? 'info' : 'success', created ? req.t('Stock scan found {0} new alert(s).', created) : req.t('Stock scan finished: nothing new.'));
    res.redirect('/alerts');
  })
);

router.post(
  '/alerts/:id/status',
  canEdit,
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    const status = req.body.status;
    if (id && ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
      const resolved = status === 'RESOLVED';
      await getDb().collection('stock_alerts').updateOne({ _id: id }, {
        $set: { status, resolved_by: resolved ? req.session.user.staff_id : null, resolved_at: resolved ? new Date() : null },
      });
      flash(req, 'success', req.t('Alert updated.'));
    }
    res.redirect('/alerts');
  })
);

router.post(
  '/alerts/:id/delete',
  canEdit,
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    // Only resolved alerts may be removed, so an open problem cannot be hidden.
    const result = id ? await getDb().collection('stock_alerts').deleteOne({ _id: id, status: 'RESOLVED' }) : { deletedCount: 0 };
    flash(req, result.deletedCount ? 'success' : 'error', req.t(result.deletedCount ? 'Alert deleted.' : 'Resolve the alert before deleting it.'));
    res.redirect('/alerts');
  })
);

// ---------- Notifications ----------
const mine = (user) => ({ $or: [{ recipient_role: user.role }, { recipient_staff_id: user.staff_id }] });

router.get(
  '/notifications',
  wrap(async (req, res) => {
    const rows = await getDb().collection('notifications').find(mine(req.session.user)).sort({ created_at: -1 }).limit(200).toArray();
    res.render('records/notifications', { title: 'Notifications', rows });
  })
);

router.post(
  '/notifications',
  canEdit,
  wrap(async (req, res) => {
    const message = String(req.body.message || '').trim();
    const role = req.body.recipient_role;
    if (!message || !STAFF_ROLES.includes(role)) {
      flash(req, 'error', req.t('Type a message and pick who should receive it.'));
    } else {
      await notify({ role, message: message.slice(0, 500), ref: { type: 'staff', id: req.session.user.staff_id } });
      flash(req, 'success', req.t('Message sent.'));
    }
    res.redirect('/notifications');
  })
);

router.post(
  '/notifications/:id/read',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    if (id) {
      await getDb().collection('notifications').updateOne(
        { _id: id, ...mine(req.session.user) }, { $set: { is_read: req.body.is_read !== 'false' } });
    }
    res.redirect('/notifications');
  })
);

router.post(
  '/notifications/:id/delete',
  wrap(async (req, res) => {
    const id = oid(req.params.id);
    if (id) await getDb().collection('notifications').deleteOne({ _id: id, ...mine(req.session.user) });
    flash(req, 'success', req.t('Notification deleted.'));
    res.redirect('/notifications');
  })
);

// ---------- Audit log (append-only: there is no edit or delete on purpose) ----------
router.get(
  '/audit',
  wrap(async (req, res) => {
    const entity = String(req.query.entity || '');
    const logs = await getDb().collection('audit_logs').find(entity ? { entity } : {}).sort({ ts: -1 }).limit(300).toArray();
    const { rows: staff } = await pool.query('SELECT staff_id, full_name FROM staff');
    const names = new Map(staff.map((s) => [s.staff_id, s.full_name]));
    const rows = logs.map((l) => ({ ...l, staff_name: names.get(l.staff_id) || '' }));
    const entities = ['sales', 'stock_lots', 'medicines', 'suppliers', 'staff', 'patient_notes', 'stock_alerts'];
    res.render('records/audit', { title: 'Audit log', rows, entity, entities });
  })
);

// ---------- Legal ledgers, built from the SQL transaction data ----------
router.get(
  '/ledgers',
  wrap(async (req, res) => {
    const { rows: purchases } = await pool.query(
      `SELECT l.received_date, l.lot_number, l.qty_received, l.expiry_date, l.unit_cost,
              m.generic_name, m.brand_name, m.strength, m.base_unit, s.name AS supplier_name
         FROM stock_lots l JOIN medicines m ON m.medicine_id = l.medicine_id
         JOIN suppliers s ON s.supplier_id = l.supplier_id
        ORDER BY l.received_date DESC, l.lot_id DESC LIMIT 300`
    );
    const { rows: khy11 } = await pool.query(
      `SELECT s.sale_id, s.sale_datetime, s.customer_name, s.status, st.full_name AS staff_name,
              m.generic_name, m.strength, m.base_unit, l.lot_number, i.quantity
         FROM sale_items i JOIN sales s ON s.sale_id = i.sale_id
         JOIN medicines m ON m.medicine_id = i.medicine_id
         JOIN stock_lots l ON l.lot_id = i.lot_id
         JOIN staff st ON st.staff_id = s.staff_id
        WHERE m.requires_khy11
        ORDER BY s.sale_datetime DESC LIMIT 300`
    );
    res.render('records/ledgers', { title: 'Ledgers', purchases, khy11 });
  })
);

module.exports = router;

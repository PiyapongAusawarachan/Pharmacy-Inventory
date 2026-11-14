const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pg');
const { STAFF_ROLES } = require('../config/contract');
const { flash } = require('../middleware/auth');
const wrap = require('../utils/asyncHandler');
const { friendlyDbError } = require('../utils/dbErrors');
const { audit } = require('../services/audit');

// Mounted at /staff, ADMIN only (see app.js).
const router = express.Router();

function parseStaff(body, { creating }) {
  const v = {
    username: String(body.username || '').trim(),
    full_name: String(body.full_name || '').trim(),
    role: body.role || '',
    is_active: creating ? true : body.is_active === 'on',
    password: String(body.password || ''),
  };
  const errors = [];
  if (creating && !/^[A-Za-z0-9_.-]{3,50}$/.test(v.username)) {
    errors.push('Username must be 3-50 characters: letters, numbers, dot, dash or underscore.');
  }
  if (!v.full_name) errors.push('Full name is required.');
  if (!STAFF_ROLES.includes(v.role)) errors.push('Pick a role.');
  if (creating && v.password.length < 6) errors.push('Password must be at least 6 characters.');
  if (!creating && v.password && v.password.length < 6) {
    errors.push('New password must be at least 6 characters (or leave it empty to keep the old one).');
  }
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
      'SELECT staff_id, username, full_name, role, is_active, created_at FROM staff ORDER BY is_active DESC, role, username'
    );
    res.render('staff/list', { title: 'Staff', rows });
  })
);

router.get('/new', (req, res) => {
  res.render('staff/form', {
    title: 'Add staff',
    mode: 'new',
    s: { username: '', full_name: '', role: 'ASSISTANT', is_active: true },
    errors: [],
  });
});

router.post(
  '/',
  wrap(async (req, res) => {
    const { v, errors } = parseStaff(req.body, { creating: true });
    const render = (errs) =>
      res.status(400).render('staff/form', { title: 'Add staff', mode: 'new', s: v, errors: errs });
    if (errors.length) return render(errors);

    try {
      const hash = await bcrypt.hash(v.password, 10);
      const { rows } = await pool.query(
        `INSERT INTO staff (username, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4) RETURNING staff_id`,
        [v.username, hash, v.full_name, v.role]
      );
      audit('STAFF_CREATED', 'staff', rows[0].staff_id, req.session.user.staff_id, {
        username: v.username,
        role: v.role,
      });
      flash(req, 'success', `Staff "${v.username}" was added.`);
      res.redirect('/staff');
    } catch (err) {
      const msg = friendlyDbError(err);
      if (!msg) throw err;
      render([msg]);
    }
  })
);

router.get(
  '/:id/edit',
  wrap(async (req, res, next) => {
    const id = parseId(req);
    const { rows } = id
      ? await pool.query('SELECT staff_id, username, full_name, role, is_active FROM staff WHERE staff_id = $1', [id])
      : { rows: [] };
    if (!rows[0]) return next();
    res.render('staff/form', { title: 'Edit staff', mode: 'edit', s: rows[0], errors: [] });
  })
);

router.post(
  '/:id',
  wrap(async (req, res, next) => {
    const id = parseId(req);
    const found = id ? await pool.query('SELECT username FROM staff WHERE staff_id = $1', [id]) : { rows: [] };
    if (!found.rows[0]) return next();

    const { v, errors } = parseStaff(req.body, { creating: false });
    const current = { ...v, staff_id: id, username: found.rows[0].username };
    const render = (errs) =>
      res.status(400).render('staff/form', { title: 'Edit staff', mode: 'edit', s: current, errors: errs });

    if (id === req.session.user.staff_id && (!v.is_active || v.role !== 'ADMIN')) {
      errors.push('You cannot deactivate yourself or remove your own admin role.');
    }
    if (errors.length) return render(errors);

    try {
      if (v.password) {
        const hash = await bcrypt.hash(v.password, 10);
        await pool.query(
          'UPDATE staff SET full_name=$1, role=$2, is_active=$3, password_hash=$4 WHERE staff_id=$5',
          [v.full_name, v.role, v.is_active, hash, id]
        );
      } else {
        await pool.query('UPDATE staff SET full_name=$1, role=$2, is_active=$3 WHERE staff_id=$4', [
          v.full_name,
          v.role,
          v.is_active,
          id,
        ]);
      }
      audit('STAFF_UPDATED', 'staff', id, req.session.user.staff_id, {
        role: v.role,
        is_active: v.is_active,
        password_changed: !!v.password,
      });
      flash(req, 'success', 'Staff updated.');
      res.redirect('/staff');
    } catch (err) {
      const msg = friendlyDbError(err);
      if (!msg) throw err;
      render([msg]);
    }
  })
);

// Delete when possible. Staff who made sales cannot be deleted (foreign key),
// so they are deactivated instead and their history stays intact.
router.post(
  '/:id/delete',
  wrap(async (req, res, next) => {
    const id = parseId(req);
    if (!id) return next();
    if (id === req.session.user.staff_id) {
      flash(req, 'error', 'You cannot delete your own account.');
      return res.redirect('/staff');
    }
    try {
      const r = await pool.query('DELETE FROM staff WHERE staff_id = $1', [id]);
      if (!r.rowCount) return next();
      audit('STAFF_DELETED', 'staff', id, req.session.user.staff_id);
      flash(req, 'success', 'Staff deleted.');
    } catch (err) {
      if (err.code !== '23503') throw err;
      await pool.query('UPDATE staff SET is_active = FALSE WHERE staff_id = $1', [id]);
      audit('STAFF_DEACTIVATED', 'staff', id, req.session.user.staff_id);
      flash(req, 'info', 'This person has sales history, so the account was deactivated instead of deleted.');
    }
    res.redirect('/staff');
  })
);

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pg');
const wrap = require('../utils/asyncHandler');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', error: null, username: '' });
});

router.post(
  '/login',
  wrap(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const { rows } = await pool.query('SELECT * FROM staff WHERE username = $1', [username]);
    const staff = rows[0];
    const ok = staff && staff.is_active && (await bcrypt.compare(password, staff.password_hash));

    if (!ok) {
      return res.status(401).render('login', {
        title: 'Sign in',
        error: 'Wrong username or password, or the account is inactive.',
        username,
      });
    }

    // Only follow return paths that stay on this site.
    let returnTo = req.session.returnTo || '/';
    if (!returnTo.startsWith('/') || returnTo.startsWith('//')) returnTo = '/';

    // New session id after login (prevents session fixation).
    await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.user = {
      staff_id: staff.staff_id,
      username: staff.username,
      full_name: staff.full_name,
      role: staff.role,
    };
    res.redirect(returnTo);
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;

const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const { DRUG_CLASSES, LEGAL_CATEGORIES, LOT_STATUSES, STAFF_ROLES } = require('./config/contract');
const { LEGAL_LABELS, LEGAL_SHORT } = require('./utils/labels');
const { requireLogin, requireRole } = require('./middleware/auth');
const { translate, LANGS } = require('./i18n');
const format = require('./utils/format');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'frontend', 'views'));

// Constants every view can use.
app.locals.DRUG_CLASSES = DRUG_CLASSES;
app.locals.LEGAL_CATEGORIES = LEGAL_CATEGORIES;
app.locals.LEGAL_LABELS = LEGAL_LABELS;
app.locals.LEGAL_SHORT = LEGAL_SHORT;
app.locals.LOT_STATUSES = LOT_STATUSES;
app.locals.STAFF_ROLES = STAFF_ROLES;
app.locals.NEAR_EXPIRY_DAYS = config.nearExpiryDays;
app.locals.icon = format.icon;
app.locals.money = format.money;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));
// Uploaded medicine images are served from the local file system.
app.use('/uploads', express.static(path.resolve(config.uploadDir)));
// Thai UI font, served from node_modules so the app needs no external font service.
app.use('/fonts', express.static(path.join(__dirname, '..', 'node_modules', '@fontsource', 'prompt', 'files'), { maxAge: '7d' }));

// Language: Thai by default, remembered in a plain cookie so it survives login and logout.
app.use((req, res, next) => {
  const m = /(?:^|;\s*)lang=(th|en)\b/.exec(req.headers.cookie || '');
  const lang = m ? m[1] : 'th';
  req.lang = lang;
  req.t = (key, ...args) => translate(lang, key, ...args);
  res.locals.lang = lang;
  res.locals.t = req.t;
  res.locals.fmtDate = (v) => format.fmtDate(v, lang);
  res.locals.fmtDateTime = (v) => format.fmtDateTime(v, lang);
  next();
});

app.get('/lang/:code', (req, res) => {
  if (LANGS.includes(req.params.code)) {
    res.cookie('lang', req.params.code, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  }
  const back = req.get('referer') || '/';
  let target = '/';
  try { target = new URL(back, `http://${req.headers.host}`).pathname; } catch (e) { /* keep '/' */ }
  res.redirect(target.startsWith('/lang') ? '/' : target);
});

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
  })
);

// Per-request values for the views: who is logged in, one-time flash message.
app.use((req, res, next) => {
  const user = req.session.user || null;
  res.locals.user = user;
  res.locals.canWrite = !!user && ['ADMIN', 'PHARMACIST'].includes(user.role);
  res.locals.isPharmacist = !!user && user.role === 'PHARMACIST';
  res.locals.flash = req.session.flash || null;
  res.locals.currentPath = req.path;
  delete req.session.flash;
  next();
});

// Sidebar badges: open stock alerts and my unread notifications (MongoDB). Never blocks a page.
app.use(async (req, res, next) => {
  res.locals.navCounts = { alerts: 0, notifications: 0 };
  const user = req.session.user;
  if (!user || req.method !== 'GET') return next();
  try {
    const db = require('./connections/mongo').getDb();
    const [alerts, notifications] = await Promise.all([
      db.collection('stock_alerts').countDocuments({ status: 'OPEN' }),
      db.collection('notifications').countDocuments({
        is_read: false, $or: [{ recipient_role: user.role }, { recipient_staff_id: user.staff_id }],
      }),
    ]);
    res.locals.navCounts = { alerts, notifications };
  } catch (err) {
    // MongoDB down: pages still work, the badges just stay empty.
  }
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/index'));
app.use('/staff', requireLogin, requireRole('ADMIN'), require('./routes/staff'));
app.use('/suppliers', requireLogin, require('./routes/suppliers'));
app.use('/medicines', requireLogin, require('./routes/medicines'));
app.use('/lots', requireLogin, require('./routes/lots'));
app.use('/sales', requireLogin, require('./routes/sales'));
app.use('/patients', requireLogin, require('./routes/patients'));
app.use('/', requireLogin, require('./routes/records'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: err.message });
});

module.exports = app;

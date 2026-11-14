const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const { DRUG_CLASSES, LEGAL_CATEGORIES, LOT_STATUSES, STAFF_ROLES } = require('./config/contract');
const { LEGAL_LABELS, LEGAL_SHORT } = require('./utils/labels');
const { requireLogin, requireRole } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Constants every view can use.
app.locals.DRUG_CLASSES = DRUG_CLASSES;
app.locals.LEGAL_CATEGORIES = LEGAL_CATEGORIES;
app.locals.LEGAL_LABELS = LEGAL_LABELS;
app.locals.LEGAL_SHORT = LEGAL_SHORT;
app.locals.LOT_STATUSES = LOT_STATUSES;
app.locals.STAFF_ROLES = STAFF_ROLES;
app.locals.NEAR_EXPIRY_DAYS = config.nearExpiryDays;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
// Uploaded medicine images are served from the local file system.
app.use('/uploads', express.static(path.resolve(config.uploadDir)));

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
  res.locals.flash = req.session.flash || null;
  res.locals.currentPath = req.path;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/index'));
app.use('/staff', requireLogin, requireRole('ADMIN'), require('./routes/staff'));
app.use('/suppliers', requireLogin, require('./routes/suppliers'));
app.use('/medicines', requireLogin, require('./routes/medicines'));
app.use('/lots', requireLogin, require('./routes/lots'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: err.message });
});

module.exports = app;

// Login and role checks.

function requireLogin(req, res, next) {
  if (!req.session.user) {
    if (req.method === 'GET') req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

// Usage: router.post('/', requireRole('ADMIN', 'PHARMACIST'), handler)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Not allowed',
        message: 'Your role does not have permission to do this.',
      });
    }
    next();
  };
}

// Put a one-time message in the session; it is shown on the next page.
function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

module.exports = { requireLogin, requireRole, flash };

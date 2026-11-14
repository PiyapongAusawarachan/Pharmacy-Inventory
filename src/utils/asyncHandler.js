// Express 4 does not catch errors from async route handlers; forward them to next().
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

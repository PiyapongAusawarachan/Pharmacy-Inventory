const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

// Images are stored on the server's own disk (no external hosting allowed).
const dir = path.resolve(config.uploadDir);
fs.mkdirSync(dir, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG or WebP images are allowed.')),
}).single('image');

// Middleware: on upload problems, set req.uploadError and carry on, so the route
// can show the form again with a message instead of a crash page.
function uploadImage(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2 MB or smaller.' : err.message;
    }
    next();
  });
}

// imagePath is the stored file name (e.g. "1731300000000-ab12cd.jpg").
function removeImageFile(imagePath) {
  if (!imagePath) return;
  fs.unlink(path.join(dir, path.basename(imagePath)), () => {});
}

module.exports = { uploadImage, removeImageFile };

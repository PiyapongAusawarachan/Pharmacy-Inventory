const express = require('express');
const { pool } = require('../db/pg');
const { DRUG_CLASSES, LEGAL_CATEGORIES } = require('../config/contract');
const { requireRole, flash } = require('../middleware/auth');
const wrap = require('../utils/asyncHandler');
const { friendlyDbError } = require('../utils/dbErrors');
const { audit } = require('../services/audit');
const { uploadImage, removeImageFile } = require('../services/upload');

// Mounted at /medicines (login required). Everyone can view; ADMIN and PHARMACIST can change.
const router = express.Router();
const WRITE = requireRole('ADMIN', 'PHARMACIST');

const FORM_DEFAULTS = {
  generic_name: '',
  brand_name: '',
  strength: '',
  dosage_form: '',
  drug_class: '',
  legal_category: 'DANGEROUS',
  requires_prescription: false,
  requires_khy11: false,
  base_unit: '',
  units_per_pack: 1,
  sell_price: '',
  reorder_level: 0,
  image_path: null,
  is_active: true,
};

function parseMedicine(body, { creating }) {
  const v = {
    // Stored lowercase, ingredients joined by '+' with no spaces (see docs/data-contract.md).
    generic_name: String(body.generic_name || '')
      .trim()
      .toLowerCase()
      .replace(/\s*\+\s*/g, '+'),
    brand_name: String(body.brand_name || '').trim() || null,
    strength: String(body.strength || '').trim(),
    dosage_form: String(body.dosage_form || '').trim(),
    drug_class: body.drug_class || '',
    legal_category: body.legal_category || '',
    requires_prescription: body.requires_prescription === 'on',
    requires_khy11: body.requires_khy11 === 'on',
    base_unit: String(body.base_unit || '').trim(),
    units_per_pack: Number(body.units_per_pack),
    sell_price: Number(body.sell_price),
    reorder_level: body.reorder_level === undefined || body.reorder_level === '' ? 0 : Number(body.reorder_level),
    is_active: creating ? true : body.is_active === 'on',
  };

  const errors = [];
  if (!v.generic_name) errors.push('Generic name is required.');
  if (v.generic_name.length > 200) errors.push('Generic name is too long (max 200 characters).');
  if (!v.strength) errors.push('Strength is required (for example 500 mg).');
  if (!v.dosage_form) errors.push('Dosage form is required (for example tablet).');
  if (!Object.prototype.hasOwnProperty.call(DRUG_CLASSES, v.drug_class)) errors.push('Pick a drug class.');
  if (!LEGAL_CATEGORIES.includes(v.legal_category)) errors.push('Pick a legal category.');
  if (!v.base_unit) errors.push('Base unit is required (the smallest unit you sell, for example tablet).');
  if (!Number.isInteger(v.units_per_pack) || v.units_per_pack < 1) errors.push('Units per pack must be a whole number of 1 or more.');
  if (!(v.sell_price >= 0)) errors.push('Sell price must be a number of 0 or more.');
  if (!Number.isInteger(v.reorder_level) || v.reorder_level < 0) errors.push('Reorder level must be a whole number of 0 or more.');
  return { v, errors };
}

function parseId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const COLS = `generic_name, brand_name, strength, dosage_form, drug_class, legal_category,
  requires_prescription, requires_khy11, base_unit, units_per_pack, sell_price, reorder_level`;

router.get(
  '/',
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = 'WHERE m.generic_name ILIKE $1 OR m.brand_name ILIKE $1';
    }
    // sellable_qty counts only lots that FEFO could sell: ACTIVE, in stock, not expired.
    const { rows } = await pool.query(
      `SELECT m.*,
         COALESCE(SUM(l.qty_on_hand) FILTER (
           WHERE l.status = 'ACTIVE' AND l.expiry_date > CURRENT_DATE), 0)::int AS sellable_qty
       FROM medicines m
       LEFT JOIN stock_lots l ON l.medicine_id = m.medicine_id
       ${where}
       GROUP BY m.medicine_id
       ORDER BY m.is_active DESC, m.generic_name, m.brand_name`,
      params
    );
    res.render('medicines/list', { title: 'Medicines', rows, q });
  })
);

router.get('/new', WRITE, (req, res) => {
  res.render('medicines/form', { title: 'Add medicine', mode: 'new', m: { ...FORM_DEFAULTS }, errors: [] });
});

router.post(
  '/',
  WRITE,
  uploadImage,
  wrap(async (req, res) => {
    const { v, errors } = parseMedicine(req.body, { creating: true });
    if (req.uploadError) errors.push(req.uploadError);
    const newImage = req.file ? req.file.filename : null;

    const fail = (errs) => {
      removeImageFile(newImage);
      res.status(400).render('medicines/form', {
        title: 'Add medicine',
        mode: 'new',
        m: { ...FORM_DEFAULTS, ...v, image_path: null },
        errors: errs,
      });
    };
    if (errors.length) return fail(errors);

    try {
      const { rows } = await pool.query(
        `INSERT INTO medicines (${COLS}, image_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING medicine_id`,
        [
          v.generic_name, v.brand_name, v.strength, v.dosage_form, v.drug_class, v.legal_category,
          v.requires_prescription, v.requires_khy11, v.base_unit, v.units_per_pack, v.sell_price,
          v.reorder_level, newImage,
        ]
      );
      audit('MEDICINE_CREATED', 'medicines', rows[0].medicine_id, req.session.user.staff_id, {
        generic_name: v.generic_name,
        legal_category: v.legal_category,
      });
      flash(req, 'success', `Medicine "${v.generic_name}" was added.`);
      res.redirect('/medicines');
    } catch (err) {
      const msg = friendlyDbError(err);
      if (!msg) {
        removeImageFile(newImage);
        throw err;
      }
      fail([msg]);
    }
  })
);

router.get(
  '/:id/edit',
  WRITE,
  wrap(async (req, res, next) => {
    const id = parseId(req);
    const { rows } = id ? await pool.query('SELECT * FROM medicines WHERE medicine_id = $1', [id]) : { rows: [] };
    if (!rows[0]) return next();
    res.render('medicines/form', { title: 'Edit medicine', mode: 'edit', m: rows[0], errors: [] });
  })
);

router.post(
  '/:id',
  WRITE,
  uploadImage,
  wrap(async (req, res, next) => {
    const id = parseId(req);
    const found = id ? await pool.query('SELECT image_path FROM medicines WHERE medicine_id = $1', [id]) : { rows: [] };
    const newImage = req.file ? req.file.filename : null;
    if (!found.rows[0]) {
      removeImageFile(newImage);
      return next();
    }
    const oldImage = found.rows[0].image_path;

    const { v, errors } = parseMedicine(req.body, { creating: false });
    if (req.uploadError) errors.push(req.uploadError);

    const fail = (errs) => {
      removeImageFile(newImage);
      res.status(400).render('medicines/form', {
        title: 'Edit medicine',
        mode: 'edit',
        m: { ...FORM_DEFAULTS, ...v, medicine_id: id, image_path: oldImage },
        errors: errs,
      });
    };
    if (errors.length) return fail(errors);

    // Keep the old image unless a new one was uploaded or "remove" was ticked.
    let imagePath = oldImage;
    if (newImage) imagePath = newImage;
    else if (req.body.remove_image === 'on') imagePath = null;

    try {
      await pool.query(
        `UPDATE medicines SET
           generic_name=$1, brand_name=$2, strength=$3, dosage_form=$4, drug_class=$5, legal_category=$6,
           requires_prescription=$7, requires_khy11=$8, base_unit=$9, units_per_pack=$10, sell_price=$11,
           reorder_level=$12, is_active=$13, image_path=$14
         WHERE medicine_id=$15`,
        [
          v.generic_name, v.brand_name, v.strength, v.dosage_form, v.drug_class, v.legal_category,
          v.requires_prescription, v.requires_khy11, v.base_unit, v.units_per_pack, v.sell_price,
          v.reorder_level, v.is_active, imagePath, id,
        ]
      );
      if (imagePath !== oldImage) removeImageFile(oldImage);
      audit('MEDICINE_UPDATED', 'medicines', id, req.session.user.staff_id, {
        generic_name: v.generic_name,
        legal_category: v.legal_category,
        is_active: v.is_active,
      });
      flash(req, 'success', 'Medicine updated.');
      res.redirect('/medicines');
    } catch (err) {
      const msg = friendlyDbError(err);
      if (!msg) {
        removeImageFile(newImage);
        throw err;
      }
      fail([msg]);
    }
  })
);

// Delete when possible. A medicine that has stock lots or sales history cannot be
// deleted (foreign key), so it is deactivated instead and the history stays intact.
router.post(
  '/:id/delete',
  WRITE,
  wrap(async (req, res, next) => {
    const id = parseId(req);
    if (!id) return next();
    const found = await pool.query('SELECT image_path FROM medicines WHERE medicine_id = $1', [id]);
    if (!found.rows[0]) return next();

    try {
      await pool.query('DELETE FROM medicines WHERE medicine_id = $1', [id]);
      removeImageFile(found.rows[0].image_path);
      audit('MEDICINE_DELETED', 'medicines', id, req.session.user.staff_id);
      flash(req, 'success', 'Medicine deleted.');
    } catch (err) {
      if (err.code !== '23503') throw err;
      await pool.query('UPDATE medicines SET is_active = FALSE WHERE medicine_id = $1', [id]);
      audit('MEDICINE_DEACTIVATED', 'medicines', id, req.session.user.staff_id);
      flash(req, 'info', 'This medicine has stock lots or sales history, so it was deactivated instead of deleted.');
    }
    res.redirect('/medicines');
  })
);

module.exports = router;

// Patients live in MongoDB (collection patient_notes): identity, allergies and free notes.
const express = require('express');
const { pool } = require('../connections/pg');
const { getDb } = require('../connections/mongo');
const wrap = require('../utils/asyncHandler');
const { requireRole, flash } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { DRUG_CLASSES, INGREDIENT_SEPARATOR } = require('../config/contract');

const router = express.Router();
const col = () => getDb().collection('patient_notes');
const canEdit = requireRole('ADMIN', 'PHARMACIST');

const TYPES = ['ALLERGY', 'INTOLERANCE'];
const CRITICALITY = ['HIGH', 'LOW', 'UNABLE_TO_ASSESS'];
const VERIFICATION = ['CONFIRMED', 'UNCONFIRMED', 'REFUTED'];
const SEVERITY = ['MILD', 'MODERATE', 'SEVERE'];

// Next code in the P00001 format (see docs/data-contract.md).
async function nextCode() {
  const last = await col().find({}).sort({ patient_code: -1 }).limit(1).toArray();
  const n = last[0] ? Number(String(last[0].patient_code).slice(1)) + 1 : 1;
  return `P${String(n).padStart(5, '0')}`;
}

// Ingredient names offered in the allergy form = every ingredient that appears in medicines.
async function ingredientList() {
  const { rows } = await pool.query('SELECT DISTINCT generic_name FROM medicines');
  const set = new Set();
  rows.forEach((r) => r.generic_name.split(INGREDIENT_SEPARATOR).forEach((i) => set.add(i)));
  return [...set].sort();
}

function parsePatient(body) {
  return { name: String(body.name || '').trim(), phone: String(body.phone || '').trim() };
}
function validate(v, t) {
  const errors = [];
  if (!v.name) errors.push(t('Patient name is required.'));
  if (v.name.length > 150) errors.push(t('Patient name is too long (max 150 characters).'));
  if (v.phone.length > 30) errors.push(t('Phone is too long (max 30 characters).'));
  return errors;
}

router.get(
  '/',
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    let rows = await col().find({}).sort({ patient_code: 1 }).toArray();
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(needle) || p.patient_code.toLowerCase().includes(needle));
    }
    res.render('patients/list', { title: 'Patients', rows, q });
  })
);

router.get('/new', canEdit, (req, res) => {
  res.render('patients/form', { title: 'Add patient', mode: 'new', p: { name: '', phone: '' }, errors: [] });
});

router.post(
  '/',
  canEdit,
  wrap(async (req, res) => {
    const v = parsePatient(req.body);
    const errors = validate(v, req.t);
    if (errors.length) {
      return res.status(400).render('patients/form', { title: 'Add patient', mode: 'new', p: v, errors });
    }
    const code = await nextCode();
    const now = new Date();
    await col().insertOne({ patient_code: code, name: v.name, phone: v.phone, allergies: [], notes: [], created_at: now, updated_at: now });
    audit('PATIENT_CREATED', 'patient_notes', code, req.session.user.staff_id, { name: v.name });
    flash(req, 'success', req.t('Patient {0} was added. Record any drug allergies now.', code));
    res.redirect(`/patients/${code}`);
  })
);

// Loads the patient for every /:code route below.
router.param('code', (req, res, next, code) => {
  col()
    .findOne({ patient_code: code })
    .then((p) => {
      if (!p) return res.status(404).render('error', { title: 'Not found', message: 'Patient not found.' });
      req.patient = p;
      next();
    })
    .catch(next);
});

router.get(
  '/:code',
  wrap(async (req, res) => {
    const { rows: sales } = await pool.query(
      `SELECT sale_id, sale_datetime, total_amount, status FROM sales
        WHERE patient_code = $1 ORDER BY sale_datetime DESC LIMIT 50`,
      [req.patient.patient_code]
    );
    res.render('patients/detail', {
      title: 'Patient', p: req.patient, sales, ingredients: await ingredientList(),
      TYPES, CRITICALITY, VERIFICATION, SEVERITY,
    });
  })
);

router.get('/:code/edit', canEdit, (req, res) => {
  res.render('patients/form', { title: 'Edit patient', mode: 'edit', p: req.patient, errors: [] });
});

router.post(
  '/:code',
  canEdit,
  wrap(async (req, res) => {
    const v = parsePatient(req.body);
    const errors = validate(v, req.t);
    if (errors.length) {
      return res.status(400).render('patients/form', {
        title: 'Edit patient', mode: 'edit', p: { ...v, patient_code: req.patient.patient_code }, errors,
      });
    }
    await col().updateOne({ patient_code: req.patient.patient_code }, { $set: { name: v.name, phone: v.phone, updated_at: new Date() } });
    audit('PATIENT_UPDATED', 'patient_notes', req.patient.patient_code, req.session.user.staff_id, { name: v.name });
    flash(req, 'success', req.t('Patient updated.'));
    res.redirect(`/patients/${req.patient.patient_code}`);
  })
);

router.post(
  '/:code/delete',
  canEdit,
  wrap(async (req, res) => {
    const code = req.patient.patient_code;
    // The link sales.patient_code -> patient_notes cannot be a real foreign key, so check it here.
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM sales WHERE patient_code = $1', [code]);
    if (rows[0].n > 0) {
      flash(req, 'error', req.t('This patient has {0} sale(s) on record, so the profile cannot be deleted.', rows[0].n));
      return res.redirect(`/patients/${code}`);
    }
    await col().deleteOne({ patient_code: code });
    audit('PATIENT_DELETED', 'patient_notes', code, req.session.user.staff_id);
    flash(req, 'success', req.t('Patient deleted.'));
    res.redirect('/patients');
  })
);

router.post(
  '/:code/allergies',
  canEdit,
  wrap(async (req, res) => {
    const code = req.patient.patient_code;
    const [level, allergenCode] = String(req.body.allergen || '').split(':');
    const ingredients = await ingredientList();
    const okAllergen =
      (level === 'CLASS' && Object.prototype.hasOwnProperty.call(DRUG_CLASSES, allergenCode) && allergenCode !== 'OTHER') ||
      (level === 'INGREDIENT' && ingredients.includes(allergenCode));
    if (!okAllergen) {
      flash(req, 'error', req.t('Pick the drug class or ingredient the patient reacts to.'));
      return res.redirect(`/patients/${code}`);
    }
    if (req.patient.allergies.some((a) => a.allergen.level === level && a.allergen.code === allergenCode)) {
      flash(req, 'error', req.t('This allergy is already on the record.'));
      return res.redirect(`/patients/${code}`);
    }
    const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
    const allergy = {
      allergen: { level, code: allergenCode, display: level === 'CLASS' ? DRUG_CLASSES[allergenCode].label : allergenCode },
      type: pick(req.body.type, TYPES, 'ALLERGY'),
      criticality: pick(req.body.criticality, CRITICALITY, 'UNABLE_TO_ASSESS'),
      verification_status: pick(req.body.verification_status, VERIFICATION, 'UNCONFIRMED'),
      reactions: [],
      recorded_by: req.session.user.staff_id,
      recorded_at: new Date(),
    };
    const manifestation = String(req.body.manifestation || '').trim();
    if (manifestation) {
      const reaction = { manifestations: manifestation.split(',').map((x) => x.trim()).filter(Boolean) };
      if (SEVERITY.includes(req.body.severity)) reaction.severity = req.body.severity;
      allergy.reactions.push(reaction);
    }
    await col().updateOne({ patient_code: code }, { $set: { allergies: [...req.patient.allergies, allergy], updated_at: new Date() } });
    audit('ALLERGY_ADDED', 'patient_notes', code, req.session.user.staff_id, { allergen: allergy.allergen });
    flash(req, 'success', req.t('Allergy recorded. It will be checked on every sale to this patient.'));
    res.redirect(`/patients/${code}`);
  })
);

router.post(
  '/:code/allergies/:index/delete',
  canEdit,
  wrap(async (req, res) => {
    const code = req.patient.patient_code;
    const i = Number(req.params.index);
    const removed = req.patient.allergies[i];
    if (removed) {
      const allergies = req.patient.allergies.filter((_, n) => n !== i);
      await col().updateOne({ patient_code: code }, { $set: { allergies, updated_at: new Date() } });
      audit('ALLERGY_REMOVED', 'patient_notes', code, req.session.user.staff_id, { allergen: removed.allergen });
      flash(req, 'success', req.t('Allergy removed.'));
    }
    res.redirect(`/patients/${code}`);
  })
);

router.post(
  '/:code/notes',
  wrap(async (req, res) => {
    const code = req.patient.patient_code;
    const text = String(req.body.text || '').trim();
    if (!text) {
      flash(req, 'error', req.t('Type a note first.'));
      return res.redirect(`/patients/${code}`);
    }
    const note = { author_staff_id: req.session.user.staff_id, ts: new Date(), text: text.slice(0, 1000), tags: [] };
    await col().updateOne({ patient_code: code }, { $set: { notes: [...(req.patient.notes || []), note], updated_at: new Date() } });
    flash(req, 'success', req.t('Note added.'));
    res.redirect(`/patients/${code}`);
  })
);

router.post(
  '/:code/notes/:index/delete',
  canEdit,
  wrap(async (req, res) => {
    const code = req.patient.patient_code;
    const i = Number(req.params.index);
    const notes = (req.patient.notes || []).filter((_, n) => n !== i);
    await col().updateOne({ patient_code: code }, { $set: { notes, updated_at: new Date() } });
    flash(req, 'success', req.t('Note deleted.'));
    res.redirect(`/patients/${code}`);
  })
);

module.exports = router;

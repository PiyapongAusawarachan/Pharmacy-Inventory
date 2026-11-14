const { getDb } = require('../db/mongo');

// Write one entry to the MongoDB audit_logs collection.
// Never throws: a logging failure must not break the action that was already saved.
async function audit(action, entity, entityId, staffId, details = {}) {
  try {
    await getDb().collection('audit_logs').insertOne({
      action,
      entity,
      entity_id: entityId ?? null,
      staff_id: staffId ?? null,
      ts: new Date(),
      details,
    });
  } catch (err) {
    console.error(`audit log failed (${action}):`, err.message);
  }
}

module.exports = { audit };

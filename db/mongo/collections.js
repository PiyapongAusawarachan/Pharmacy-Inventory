// MongoDB collections with $jsonSchema validators.
// Value lists must match src/config/contract.js (see docs/data-contract.md).
const { STAFF_ROLES, ALLERGEN_LEVELS } = require('../../src/config/contract');

const date = { bsonType: 'date' };
const int = { bsonType: ['int', 'long'] };
const str = { bsonType: 'string' };

const collections = {
  // Patient identity + allergies (FHIR AllergyIntolerance-like) + free notes.
  patient_notes: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['patient_code', 'name', 'allergies', 'created_at'],
        properties: {
          patient_code: str,
          name: str,
          phone: str,
          allergies: {
            bsonType: 'array',
            items: {
              bsonType: 'object',
              required: ['allergen', 'type', 'recorded_at'],
              properties: {
                allergen: {
                  bsonType: 'object',
                  required: ['level', 'code', 'display'],
                  properties: {
                    level: { enum: ALLERGEN_LEVELS },
                    // CLASS -> a DRUG_CLASSES key; INGREDIENT -> lowercase ingredient name
                    code: str,
                    display: str,
                  },
                },
                type: { enum: ['ALLERGY', 'INTOLERANCE'] },
                criticality: { enum: ['LOW', 'HIGH', 'UNABLE_TO_ASSESS'] },
                verification_status: { enum: ['UNCONFIRMED', 'CONFIRMED', 'REFUTED'] },
                reactions: {
                  bsonType: 'array',
                  items: {
                    bsonType: 'object',
                    properties: {
                      manifestations: { bsonType: 'array', items: str },
                      severity: { enum: ['MILD', 'MODERATE', 'SEVERE'] },
                      notes: str,
                    },
                  },
                },
                recorded_by: int,
                recorded_at: date,
              },
            },
          },
          notes: {
            bsonType: 'array',
            items: {
              bsonType: 'object',
              required: ['text', 'ts'],
              properties: {
                author_staff_id: int,
                ts: date,
                text: str,
                tags: { bsonType: 'array', items: str },
              },
            },
          },
          created_at: date,
          updated_at: date,
        },
      },
    },
    indexes: [{ key: { patient_code: 1 }, options: { unique: true } }],
  },

  // Low-stock / near-expiry / expired alerts.
  stock_alerts: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['type', 'medicine_id', 'status', 'created_at'],
        properties: {
          type: { enum: ['LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED'] },
          medicine_id: int,
          lot_id: { bsonType: ['int', 'long', 'null'] },
          current_qty: int,
          threshold: int,
          expiry_date: { bsonType: ['date', 'null'] },
          status: { enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] },
          created_at: date,
          resolved_by: { bsonType: ['int', 'long', 'null'] },
          resolved_at: { bsonType: ['date', 'null'] },
        },
      },
    },
    indexes: [{ key: { status: 1, type: 1 } }, { key: { medicine_id: 1 } }],
  },

  // Every important action, including rolled-back sales.
  audit_logs: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['action', 'entity', 'ts'],
        properties: {
          action: str, // e.g. SALE_COMMITTED, SALE_ROLLED_BACK, SALE_CANCELLED, LOT_CREATED
          entity: str, // e.g. 'sales', 'stock_lots'
          entity_id: { bsonType: ['int', 'long', 'string', 'null'] },
          staff_id: { bsonType: ['int', 'long', 'null'] },
          ts: date,
          details: { bsonType: 'object' },
        },
      },
    },
    indexes: [{ key: { ts: -1 } }, { key: { entity: 1, entity_id: 1 } }],
  },

  // Messages to staff (by role or to one person).
  notifications: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['message', 'is_read', 'created_at'],
        anyOf: [{ required: ['recipient_role'] }, { required: ['recipient_staff_id'] }],
        properties: {
          recipient_role: { enum: STAFF_ROLES },
          recipient_staff_id: int,
          message: str,
          ref: {
            bsonType: 'object',
            properties: { type: str, id: { bsonType: ['int', 'long', 'string'] } },
          },
          is_read: { bsonType: 'bool' },
          created_at: date,
        },
      },
    },
    indexes: [{ key: { recipient_role: 1, is_read: 1, created_at: -1 } }],
  },
};

module.exports = collections;

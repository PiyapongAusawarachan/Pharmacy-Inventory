# NoSQL Document Schema (MongoDB)

Source of truth: `db/mongo/collections.js` (each collection has a `$jsonSchema` validator).

```mermaid
flowchart LR
    subgraph SQL["PostgreSQL"]
        MED[(medicines)]
        LOT[(stock_lots)]
        SAL[(sales)]
        STF[(staff)]
    end

    subgraph MONGO["MongoDB"]
        PN["patient_notes
        ─────────────
        patient_code (unique)
        name, phone
        allergies[ ]
          allergen {level, code, display}
          type, criticality
          verification_status
          reactions[ ] {manifestations[ ], severity, notes}
          recorded_by, recorded_at
        notes[ ] {author_staff_id, ts, text, tags[ ]}
        created_at, updated_at"]

        SA["stock_alerts
        ─────────────
        type: LOW_STOCK | NEAR_EXPIRY | EXPIRED
        medicine_id, lot_id
        current_qty, threshold, expiry_date
        status: OPEN | ACKNOWLEDGED | RESOLVED
        created_at, resolved_by, resolved_at"]

        AL["audit_logs
        ─────────────
        action (SALE_COMMITTED, SALE_ROLLED_BACK, ...)
        entity, entity_id, staff_id, ts
        details {allocations[ ] {lot_id, qty}, reason, ...}"]

        NO["notifications
        ─────────────
        recipient_role | recipient_staff_id
        message, ref {type, id}
        is_read, created_at"]
    end

    SAL -.->|patient_code| PN
    PN -.->|allergen.code matches drug_class or generic_name| MED
    SA -.->|medicine_id| MED
    SA -.->|lot_id| LOT
    AL -.->|entity_id| SAL
    AL -.->|staff_id| STF
    NO -.->|ref.id| SA
```

Dotted lines are logical references checked by the application. MongoDB and PostgreSQL can't enforce foreign keys between each other.

## Why each collection is in NoSQL

| Collection | Reason |
|---|---|
| `patient_notes` | Nested, variable structure: each patient has a different number of allergies, each allergy a different number of reactions and symptoms. Matches the HL7 FHIR AllergyIntolerance shape. |
| `stock_alerts` | Fields differ by alert type (expiry alerts have a lot and date, low-stock alerts don't). Created and resolved often. |
| `audit_logs` | Append-heavy; `details` differs per action (a sale stores lot allocations, a lot update stores old/new values). |
| `notifications` | Short-lived messages, addressed to a role or a person; read/unread status changes often. |

## When each collection is written

| Collection | Written when |
|---|---|
| `patient_notes` | CRUD from the patient page; **read before** a sale to check allergies |
| `stock_alerts` | After a sale commits and stock falls to `reorder_level` or below; during the expiry scan (`NEAR_EXPIRY_DAYS`, default 180) |
| `audit_logs` | After every commit, **and after every rollback** (`SALE_ROLLED_BACK`) |
| `notifications` | After commit when an alert is raised or a specially controlled drug is sold |

See `docs/data-contract.md` for the allergen format and matching rule.

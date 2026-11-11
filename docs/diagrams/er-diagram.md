# SQL ER Diagram (PostgreSQL)

Source of truth: `db/sql/001_schema.sql`. GitHub renders this Mermaid diagram automatically.

```mermaid
erDiagram
    STAFF ||--o{ SALES : "makes"
    STAFF |o--o{ SALES : "cancels"
    SUPPLIERS ||--o{ STOCK_LOTS : "supplies"
    MEDICINES ||--o{ STOCK_LOTS : "has lots"
    MEDICINES ||--o{ SALE_ITEMS : "sold as"
    STOCK_LOTS ||--o{ SALE_ITEMS : "deducted from"
    SALES ||--|{ SALE_ITEMS : "contains"

    STAFF {
        int staff_id PK
        varchar username UK
        varchar password_hash
        varchar full_name
        enum role "ADMIN | PHARMACIST | ASSISTANT"
        bool is_active
        timestamptz created_at
    }
    SUPPLIERS {
        int supplier_id PK
        varchar name UK
        varchar phone
        text address
        bool is_active
        timestamptz created_at
    }
    MEDICINES {
        int medicine_id PK
        varchar generic_name "lowercase, '+' for combos"
        varchar brand_name
        varchar strength
        varchar dosage_form
        varchar drug_class "CHECK: contract list"
        enum legal_category "HOUSEHOLD | PACKAGED_NON_DANGEROUS | DANGEROUS | SPECIAL_CONTROLLED"
        bool requires_prescription
        bool requires_khy11
        varchar base_unit
        int units_per_pack
        numeric sell_price "per base unit"
        int reorder_level
        varchar image_path "local file"
        bool is_active
        timestamptz created_at
    }
    STOCK_LOTS {
        int lot_id PK
        int medicine_id FK
        int supplier_id FK
        varchar lot_number "UK with medicine_id"
        date mfg_date
        date expiry_date "CHECK > mfg_date"
        date received_date
        int qty_received
        int qty_on_hand "CHECK 0..qty_received"
        numeric unit_cost
        enum status "ACTIVE | QUARANTINED | EXPIRED | RECALLED"
        timestamptz created_at
    }
    SALES {
        int sale_id PK
        int staff_id FK
        timestamptz sale_datetime
        varchar patient_code "-> Mongo patient_notes"
        varchar customer_name
        numeric total_amount
        enum status "COMPLETED | CANCELLED"
        timestamptz cancelled_at
        int cancelled_by FK
    }
    SALE_ITEMS {
        int sale_item_id PK
        int sale_id FK
        int medicine_id FK
        int lot_id FK "(lot_id, medicine_id) -> stock_lots"
        int quantity
        numeric unit_price
    }
```

## Design notes

- **One `sale_items` row per lot deducted.** FEFO can split one medicine across several lots, so a bill for 30 tablets may produce two rows (e.g. 20 from lot A, 10 from lot B).
- **Composite FK `(lot_id, medicine_id)`** guarantees a sale line can't claim a lot that belongs to a different medicine.
- **`ON DELETE RESTRICT` everywhere.** Medicines, lots and staff with history can't be deleted; deactivate them (`is_active`, `status`) instead. Deleting a sale is a cancellation transaction that returns stock.
- **Partial index `idx_stock_lots_fefo`** on `(medicine_id, expiry_date, received_date) WHERE status = 'ACTIVE'` serves the FEFO lookup.

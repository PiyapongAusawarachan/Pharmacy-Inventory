-- Pharmacy Inventory - PostgreSQL schema
-- 6 tables: staff, suppliers, medicines, stock_lots, sales, sale_items
-- Value lists here must match src/config/contract.js (see docs/data-contract.md).

-- ---------- Enum types ----------
CREATE TYPE staff_role     AS ENUM ('ADMIN', 'PHARMACIST', 'ASSISTANT');
CREATE TYPE legal_category AS ENUM ('HOUSEHOLD', 'PACKAGED_NON_DANGEROUS', 'DANGEROUS', 'SPECIAL_CONTROLLED');
CREATE TYPE lot_status     AS ENUM ('ACTIVE', 'QUARANTINED', 'EXPIRED', 'RECALLED');
CREATE TYPE sale_status    AS ENUM ('COMPLETED', 'CANCELLED');

-- ---------- staff ----------
CREATE TABLE staff (
  staff_id       SERIAL PRIMARY KEY,
  username       VARCHAR(50)  NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  full_name      VARCHAR(100) NOT NULL,
  role           staff_role   NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------- suppliers ----------
CREATE TABLE suppliers (
  supplier_id  SERIAL PRIMARY KEY,
  name         VARCHAR(150) NOT NULL UNIQUE,
  phone        VARCHAR(30),
  address      TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- medicines ----------
CREATE TABLE medicines (
  medicine_id            SERIAL PRIMARY KEY,
  -- lowercase ingredients joined by '+', e.g. 'amoxicillin+clavulanic acid'
  generic_name           VARCHAR(200)   NOT NULL,
  brand_name             VARCHAR(150),
  strength               VARCHAR(50)    NOT NULL,          -- e.g. '500 mg', '5 mg/5 ml'
  dosage_form            VARCHAR(50)    NOT NULL,          -- e.g. 'tablet', 'syrup'
  drug_class             VARCHAR(30)    NOT NULL,
  legal_category         legal_category NOT NULL,
  requires_prescription  BOOLEAN        NOT NULL DEFAULT FALSE,
  requires_khy11         BOOLEAN        NOT NULL DEFAULT FALSE,  -- sale must be logged on ขย.11
  base_unit              VARCHAR(20)    NOT NULL,          -- smallest unit sold: tablet, ml, bottle...
  units_per_pack         INTEGER        NOT NULL DEFAULT 1,
  sell_price             NUMERIC(10,2)  NOT NULL,          -- per base unit
  reorder_level          INTEGER        NOT NULL DEFAULT 0, -- in base units
  image_path             VARCHAR(255),                     -- file under UPLOAD_DIR (local only)
  is_active              BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_medicines_generic_lower CHECK (generic_name = LOWER(generic_name)),
  CONSTRAINT chk_medicines_drug_class CHECK (drug_class IN (
    'PENICILLINS', 'CEPHALOSPORINS', 'MACROLIDES', 'FLUOROQUINOLONES', 'TETRACYCLINES',
    'SULFONAMIDES', 'NSAIDS', 'PARACETAMOL', 'OPIOIDS', 'ANTIHISTAMINES', 'ANTITUSSIVES',
    'CORTICOSTEROIDS', 'PDE5_INHIBITORS', 'ANTACIDS', 'PPIS', 'ANTIDIARRHEALS', 'VITAMINS', 'OTHER'
  )),
  CONSTRAINT chk_medicines_units_per_pack CHECK (units_per_pack > 0),
  CONSTRAINT chk_medicines_sell_price     CHECK (sell_price >= 0),
  CONSTRAINT chk_medicines_reorder_level  CHECK (reorder_level >= 0),
  -- Specially controlled drugs are always prescription-only.
  CONSTRAINT chk_medicines_special_rx CHECK (
    legal_category <> 'SPECIAL_CONTROLLED' OR requires_prescription
  ),
  CONSTRAINT uq_medicines_product UNIQUE (generic_name, brand_name, strength, dosage_form)
);

-- ---------- stock_lots ----------
CREATE TABLE stock_lots (
  lot_id         SERIAL PRIMARY KEY,
  medicine_id    INTEGER     NOT NULL REFERENCES medicines(medicine_id) ON DELETE RESTRICT,
  supplier_id    INTEGER     NOT NULL REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
  lot_number     VARCHAR(50) NOT NULL,
  mfg_date       DATE,
  expiry_date    DATE        NOT NULL,
  received_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  qty_received   INTEGER     NOT NULL,              -- base units
  qty_on_hand    INTEGER     NOT NULL,              -- base units
  unit_cost      NUMERIC(10,2) NOT NULL DEFAULT 0,  -- per base unit
  status         lot_status  NOT NULL DEFAULT 'ACTIVE',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_stock_lots_lot UNIQUE (medicine_id, lot_number),
  -- lets sale_items check that a lot really belongs to the medicine sold
  CONSTRAINT uq_stock_lots_lot_medicine UNIQUE (lot_id, medicine_id),
  CONSTRAINT chk_stock_lots_qty_received CHECK (qty_received > 0),
  CONSTRAINT chk_stock_lots_qty_on_hand  CHECK (qty_on_hand >= 0 AND qty_on_hand <= qty_received),
  CONSTRAINT chk_stock_lots_dates        CHECK (mfg_date IS NULL OR expiry_date > mfg_date),
  CONSTRAINT chk_stock_lots_unit_cost    CHECK (unit_cost >= 0)
);

-- FEFO lookup: active lots of a medicine ordered by expiry, then receipt.
CREATE INDEX idx_stock_lots_fefo
  ON stock_lots (medicine_id, expiry_date, received_date)
  WHERE status = 'ACTIVE';

-- ---------- sales ----------
CREATE TABLE sales (
  sale_id        SERIAL PRIMARY KEY,
  staff_id       INTEGER     NOT NULL REFERENCES staff(staff_id) ON DELETE RESTRICT,
  sale_datetime  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  patient_code   VARCHAR(30),   -- refers to MongoDB patient_notes.patient_code (checked in app)
  customer_name  VARCHAR(150),  -- required by app when ขย.10 / ขย.11 drugs are sold
  total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  status         sale_status NOT NULL DEFAULT 'COMPLETED',
  cancelled_at   TIMESTAMPTZ,
  cancelled_by   INTEGER REFERENCES staff(staff_id) ON DELETE RESTRICT,

  CONSTRAINT chk_sales_total CHECK (total_amount >= 0),
  CONSTRAINT chk_sales_cancel CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  )
);

-- ---------- sale_items ----------
-- One row per lot deducted: a FEFO sale of one medicine can span several lots.
CREATE TABLE sale_items (
  sale_item_id  SERIAL PRIMARY KEY,
  sale_id       INTEGER       NOT NULL REFERENCES sales(sale_id) ON DELETE RESTRICT,
  medicine_id   INTEGER       NOT NULL,
  lot_id        INTEGER       NOT NULL,
  quantity      INTEGER       NOT NULL,  -- base units
  unit_price    NUMERIC(10,2) NOT NULL,  -- price per base unit at time of sale

  CONSTRAINT fk_sale_items_lot FOREIGN KEY (lot_id, medicine_id)
    REFERENCES stock_lots (lot_id, medicine_id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_items_medicine FOREIGN KEY (medicine_id)
    REFERENCES medicines (medicine_id) ON DELETE RESTRICT,
  CONSTRAINT uq_sale_items_sale_lot UNIQUE (sale_id, lot_id),
  CONSTRAINT chk_sale_items_quantity   CHECK (quantity > 0),
  CONSTRAINT chk_sale_items_unit_price CHECK (unit_price >= 0)
);

CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX idx_sales_datetime ON sales (sale_datetime);

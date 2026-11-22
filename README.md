# Pharmacy Inventory & Dispensing System

A web app for staff of one Thai retail pharmacy. It tracks stock **by lot** (lot number, expiry date, quantity) and deducts stock at sale time using **FEFO** (First-Expire, First-Out) inside a single SQL transaction that rolls back if stock is insufficient. Patient allergies are checked before each sale, and audit logs, stock alerts and notifications are written to MongoDB after the sale commits.

Built for a database course project that requires a hybrid SQL + NoSQL architecture, full CRUD, and atomic transactions with rollback.

> **Status:** all core features are in place: login with roles, master data (staff, suppliers, medicines with image upload, stock lots), sales with the FEFO transaction and rollback, bill cancellation, patient allergy records, stock alerts, notifications, the audit log and the ข.ย.9 / ข.ย.11 ledgers. The UI is in Thai and English (switch in the sidebar).

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18+, Express 4 |
| Frontend | Server-rendered EJS templates |
| SQL database | PostgreSQL 16 (local, Docker) |
| NoSQL database | MongoDB 7 (local, Docker) |
| Image storage | Local file system (`uploads/`) |

No external APIs, cloud databases or image hosting are used.

## Setup

**Requirements:** Node.js 18 or newer, Docker Desktop (or Docker Engine with Compose).

1. Clone the repository and go into it:

   ```
   git clone https://github.com/PiyapongAusawarachan/Pharmacy-Inventory.git
   cd Pharmacy-Inventory
   ```

2. Create your settings file:

   ```
   cp .env.example .env
   ```

3. Start PostgreSQL and MongoDB locally, then install the packages:

   ```
   docker compose up -d
   npm install
   ```

4. Create the tables and collections, then load the demo data. **`db:reset` deletes all existing data.**

   ```
   npm run db:reset
   npm run db:seed
   ```

5. Run the app:

   ```
   npm run dev
   ```

Open <http://localhost:3000> and sign in with one of the demo accounts below. `GET /health` shows whether both databases are connected.

To stop the databases: `docker compose down` (add `-v` to delete their data too).

### Troubleshooting

- **`port is already allocated` when starting Docker:** another program already uses that port (for example another MongoDB on 27017). Add `MONGO_PORT=27018` to `.env` and change `MONGO_URL` to `mongodb://localhost:27018`. The same works for PostgreSQL with `PG_PORT`. Then run `docker compose up -d` again.
- **`ECONNREFUSED` from `db:reset`:** the databases are still starting. Wait a few seconds and run it again.

## Demo accounts

Created by `npm run db:seed`. For local development only.

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Pharmacist | `pharmacist` | `pharma123` |
| Assistant | `assistant` | `assist123` |

| Role | Can do |
|---|---|
| ADMIN | Everything, including managing staff accounts |
| PHARMACIST | View everything; add, edit and delete medicines, suppliers and stock lots |
| ASSISTANT | View medicines, stock lots and suppliers (read-only) |

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Web server port |
| `SESSION_SECRET` | `dev-only-secret-change-me` | Secret that signs login cookies |
| `PG_HOST` / `PG_PORT` | `localhost` / `5432` | PostgreSQL address |
| `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` | `pharmacy` | PostgreSQL login and database |
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGO_DB` | `pharmacy` | MongoDB database name |
| `MONGO_PORT` | `27017` | Port Docker publishes MongoDB on (only used by `docker compose`) |
| `UPLOAD_DIR` | `uploads` | Folder for uploaded medicine images |
| `NEAR_EXPIRY_DAYS` | `180` | Days before expiry that a lot is flagged (GPP: 6–8 months) |

## Database design

**PostgreSQL – 6 tables:** `staff`, `suppliers`, `medicines`, `stock_lots`, `sales`, `sale_items`
**MongoDB – 4 collections:** `patient_notes`, `stock_alerts`, `audit_logs`, `notifications`

- [SQL ER diagram](docs/diagrams/er-diagram.md)
- [NoSQL document schema](docs/diagrams/nosql-schema.md)
- [System architecture and sale flow](docs/diagrams/architecture.md)
- [Data contract between the two databases](docs/data-contract.md) (drug classes, allergen format, matching rule)

Integrity rules enforced by the database include: lowercase `generic_name`, a fixed `drug_class` list, specially controlled drugs must require a prescription, unique lot numbers per medicine, `expiry_date > mfg_date`, `0 ≤ qty_on_hand ≤ qty_received`, a sale line's lot must belong to the same medicine, and no deleting records that have sales history.

## How delete works

Deleting something that has history would break the audit trail, so the app handles it like this:

| Item | If it has no history | If it has history |
|---|---|---|
| Staff, supplier, medicine | Deleted | Deactivated (`is_active = false`), history kept |
| Stock lot | Deleted | Refused; set the status to `QUARANTINED`, `EXPIRED` or `RECALLED` instead |

Stock is always stored in the medicine's **base unit** (for example tablets). When receiving a lot you enter packs, and the app stores `packs × units_per_pack`.

## Routes (login required except `/login` and `/health`)

| Method and path | Who | What |
|---|---|---|
| `GET /health` | anyone | Database connectivity as JSON |
| `GET /login`, `POST /login`, `POST /logout` | anyone | Sign in and out |
| `GET /` | any role | Dashboard: today's sales, stock counters, urgent lots, latest activity, database status |
| `GET /medicines` | any role | List and search (`?q=`) with sellable stock |
| `GET /medicines/new`, `POST /medicines` | admin, pharmacist | Add (multipart form with optional image) |
| `GET /medicines/:id/edit`, `POST /medicines/:id` | admin, pharmacist | Edit, replace or remove image |
| `POST /medicines/:id/delete` | admin, pharmacist | Delete or deactivate |
| `GET /lots` | any role | List with filters `?medicine=`, `?status=`, `?view=near\|expired` |
| `GET /lots/new`, `POST /lots` | admin, pharmacist | Receive a lot |
| `GET /lots/:id/edit`, `POST /lots/:id` | admin, pharmacist | Correct quantity, change status, fix details |
| `POST /lots/:id/delete` | admin, pharmacist | Delete if never sold |
| `GET /suppliers`, `/suppliers/new`, `/suppliers/:id/edit` and matching `POST` routes | any role to view; admin, pharmacist to change | Supplier CRUD |
| `GET /staff`, `/staff/new`, `/staff/:id/edit` and matching `POST` routes | admin | Staff CRUD |
| `GET /sales/new`, `POST /sales` | any role (see rules below) | Sale screen; `POST` runs the FEFO transaction |
| `GET /sales`, `GET /sales/:id` | any role | Sales history (`?status=`) and one bill with the lots it was deducted from |
| `POST /sales/:id/cancel` | admin, pharmacist | Cancel a bill: stock goes back to the original lots in one transaction |
| `GET /patients`, `/patients/new`, `/patients/:code`, `/patients/:code/edit` and matching `POST` routes | any role to view; admin, pharmacist to change | Patient CRUD in MongoDB |
| `POST /patients/:code/allergies`, `.../allergies/:index/delete` | admin, pharmacist | Add or remove an allergy |
| `POST /patients/:code/notes`, `.../notes/:index/delete` | any role to add; admin, pharmacist to delete | Free notes |
| `GET /alerts`, `POST /alerts/scan` | any role | Stock alerts; the scan creates low-stock, near-expiry and expired alerts |
| `POST /alerts/:id/status`, `POST /alerts/:id/delete` | admin, pharmacist | Acknowledge, resolve, reopen; delete only when resolved |
| `GET /notifications`, `POST /notifications` | any role to read; admin, pharmacist to send | Messages by role |
| `POST /notifications/:id/read`, `.../delete` | the recipient | Mark read or unread, delete |
| `GET /audit` | any role | Audit log (`?entity=`) |
| `POST /audit/purge` | admin | Delete audit entries older than N days (the purge is logged) |
| `GET /ledgers` | any role | ข.ย.11 (sales of designated dangerous drugs) and ข.ย.9 (purchases), built from SQL |
| `GET /lang/th`, `GET /lang/en` | anyone | Switch the UI language (stored in a cookie) |

## How a sale works

1. **Checks before any stock is touched** (`backend/routes/sales.js`):
   - dangerous and specially controlled drugs can only be sold by the **pharmacist** account;
   - drugs flagged for ข.ย.11 or prescription need a customer name; some have a maximum quantity per bill (dextromethorphan: 20 tablets);
   - if a patient profile is chosen, every medicine is matched against the allergies in MongoDB (rule in `docs/data-contract.md`). An exact ingredient match needs a typed reason from the pharmacist; a same-class match needs a tick-box confirmation. Allergies marked `REFUTED` are ignored.
2. **One SQL transaction** (`backend/services/sale.js`): insert the sale, lock the medicine's sellable lots with `SELECT ... FOR UPDATE` ordered by expiry date, deduct across lots (one `sale_items` row per lot), update the total. Expired, quarantined and empty lots are never used.
3. **If any medicine is short**, the code throws, `withTransaction()` runs `ROLLBACK`, and nothing is saved. The failed attempt is written to MongoDB as `SALE_ROLLED_BACK`.
4. **After `COMMIT`**, MongoDB gets `SALE_COMMITTED` (and `ALLERGY_OVERRIDE` if a warning was overridden) and a notification for the pharmacist. If a medicine fell to its reorder level, it also gets a `LOW_STOCK` alert and a notification.

Known limitation: the two databases are not in one distributed transaction. If a MongoDB write fails after the SQL commit, the sale stands and only the log entry is missing (the error is printed on the server).

Audit entries cannot be edited. Only an admin can delete entries older than a chosen number of days, and that deletion is itself logged (`AUDIT_PURGED`).

### How to show the two transaction cases

Sign in as `pharmacist` / `pharma123`, open **New sale**:

- **Success:** add Tylenol, set the quantity to 60 and confirm. The bill shows lot `X-SOON` × 50 and lot `A001` × 10.
- **Rollback:** add Sara × 10 and Keflex (cefalexin) × 20. Only 5 cefalexin are in stock, so the whole bill is refused, the Sara stock is unchanged, and **Audit log** shows the rolled-back attempt.

## Project structure

The app is server-rendered (Express renders the EJS pages), so it is one app, not two. The folders are split by job:

```
├── frontend/                   # What the user sees
│   ├── views/                  # EJS pages (partials/, medicines/, lots/, sales/, patients/, ...)
│   └── public/                 # css/style.css, js/ (sale.js, combo.js), favicon.svg
├── backend/                    # Server code
│   ├── app.js, server.js       # Express setup and start-up
│   ├── routes/                 # One file per page group (sales.js, medicines.js, ...)
│   ├── services/               # Sale/cancel transaction, allergy check, alerts, audit log, upload
│   ├── connections/            # pg pool (withTransaction) and Mongo client
│   ├── middleware/             # login and role checks
│   ├── config/                 # env config + shared data contract constants
│   ├── i18n/                   # Thai/English text
│   └── utils/                  # helpers (async wrapper, DB error messages, labels)
├── database/
│   ├── sql/001_schema.sql      # PostgreSQL tables, enums, constraints, indexes
│   ├── mongo/collections.js    # MongoDB collections, validators, indexes
│   └── scripts/
│       ├── db-reset.js         # npm run db:reset
│       └── seed.js             # npm run db:seed
├── docs/
│   ├── diagrams/               # ER, NoSQL schema, architecture (Mermaid)
│   ├── screenshots/            # Feature and transaction proof screenshots
│   ├── data-contract.md
│   └── data-sources.md
├── uploads/                    # Local image storage (git-ignored)
├── docker-compose.yml          # PostgreSQL + MongoDB
└── package.json                # npm run dev / start / db:reset / db:seed (same commands as before)
```

## Seed data

`npm run db:seed` loads 3 demo accounts, 3 suppliers, 54 medicines and 86 stock lots into PostgreSQL (including expired lots, lots expiring within 180 days, a quarantined lot and a low-stock medicine), and 12 patients and 3 notifications into MongoDB, so every screen has something to show.

The medicine list is hand-written demo data, **not** an import of Thai Medicines Terminology (TMT). Every row is marked `UNVERIFIED`: legal categories, counselling text and most prices are working assumptions, and patients and suppliers are invented. See [docs/data-sources.md](docs/data-sources.md) for what was actually observed and what was left out on purpose. Nothing here is clinical advice.

## Screenshots

See [`docs/screenshots/`](docs/screenshots/).

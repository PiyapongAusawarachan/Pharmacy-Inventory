# Pharmacy Inventory & Dispensing System

A web app for staff of one Thai retail pharmacy. It tracks stock **by lot** (lot number, expiry date, quantity) and deducts stock at sale time using **FEFO** (First-Expire, First-Out) inside a single SQL transaction that rolls back if stock is insufficient. Patient allergies are checked before each sale, and audit logs, stock alerts and notifications are written to MongoDB after the sale commits.

Built for a database course project that requires a hybrid SQL + NoSQL architecture, full CRUD, and atomic transactions with rollback.

> **Status:** done so far: database design, login with roles, and the master-data pages (staff, suppliers, medicines with image upload, stock lots). Next: sales with the FEFO transaction, patient allergy notes, alerts, notifications and the audit log page.

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
| `GET /` | any role | Dashboard: stock counters and database status |
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

Sales, patients, alerts, notifications and audit-log pages will be added next.

## Project structure

```
├── db/
│   ├── sql/001_schema.sql      # PostgreSQL tables, enums, constraints, indexes
│   └── mongo/collections.js    # MongoDB collections, validators, indexes
├── docs/
│   ├── diagrams/               # ER, NoSQL schema, architecture (Mermaid)
│   ├── screenshots/            # Feature and transaction proof screenshots
│   └── data-contract.md
├── public/css/                 # Static files
├── scripts/
│   ├── db-reset.js             # npm run db:reset
│   └── seed.js                 # npm run db:seed
├── src/
│   ├── config/                 # env config + shared data contract constants
│   ├── db/                     # pg pool (withTransaction) and Mongo client
│   ├── middleware/             # login and role checks
│   ├── routes/                 # Express routes
│   ├── services/               # audit log writer, image upload
│   ├── utils/                  # helpers (async wrapper, DB error messages, labels)
│   ├── views/                  # EJS templates
│   ├── app.js
│   └── server.js
├── uploads/                    # Local image storage (git-ignored)
└── docker-compose.yml
```

## Seed data

`npm run db:seed` loads 3 demo accounts, 3 suppliers, 26 common medicines and 56 stock lots, including expired lots, lots expiring within 180 days, a quarantined lot and two low-stock medicines, so every screen has something to show.

The medicine list is hand-written demo data. It is **not** an import of Thai Medicines Terminology (TMT), and the legal categories are working assumptions from secondary sources, so check them with a pharmacist or the Thai FDA lists before treating them as legally accurate. Single-ingredient tramadol is left out on purpose because it became a specially controlled drug in 2025.

## Screenshots

See [`docs/screenshots/`](docs/screenshots/) (to be added).

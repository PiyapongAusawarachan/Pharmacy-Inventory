# Pharmacy Inventory & Dispensing System

A web app for staff of one Thai retail pharmacy. It tracks stock **by lot** (lot number, expiry date, quantity) and deducts stock at sale time using **FEFO** (First-Expire, First-Out) inside a single SQL transaction that rolls back if stock is insufficient. Patient allergies are checked before each sale, and audit logs, stock alerts and notifications are written to MongoDB after the sale commits.

Built for a database course project that requires a hybrid SQL + NoSQL architecture, full CRUD, and atomic transactions with rollback.

> **Status:** setup and design phase. Database schema, data contract and diagrams are done; CRUD pages and the sale transaction are next.

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

```bash
# 1. Clone
git clone https://github.com/PiyapongAusawarachan/Pharmacy-Inventory.git
cd Pharmacy-Inventory

# 2. Environment variables
cp .env.example .env

# 3. Start PostgreSQL and MongoDB locally
docker compose up -d

# 4. Install dependencies
npm install

# 5. Create tables and collections (WARNING: drops existing data)
npm run db:reset

# 6. Run the app
npm run dev        # auto-restart on changes
# or: npm start
```

Open <http://localhost:3000>. The home page shows whether both databases are connected and lists their tables and collections. `GET /health` returns the same as JSON.

To stop the databases: `docker compose down` (add `-v` to delete their data too).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Web server port |
| `PG_HOST` / `PG_PORT` | `localhost` / `5432` | PostgreSQL address |
| `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` | `pharmacy` | PostgreSQL login and database |
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGO_DB` | `pharmacy` | MongoDB database name |
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
├── scripts/db-reset.js         # npm run db:reset
├── src/
│   ├── config/                 # env config + shared data contract constants
│   ├── db/                     # pg pool (withTransaction) and Mongo client
│   ├── routes/                 # Express routes
│   ├── views/                  # EJS templates
│   ├── app.js
│   └── server.js
├── uploads/                    # Local image storage (git-ignored)
└── docker-compose.yml
```

## API documentation

_To be added as routes are built._

## Seed data

_To be added._ Planned source: a 30–50 drug subset of Thai Medicines Terminology (TMT) by THIS, converted to CSV and imported locally. Registration numbers in seed data are fictional.

## Screenshots

See [`docs/screenshots/`](docs/screenshots/) (to be added).

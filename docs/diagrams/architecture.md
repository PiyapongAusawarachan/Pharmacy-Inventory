# System Architecture

Everything runs locally: no external APIs, no cloud databases, images on the server's own disk.

```mermaid
flowchart TB
    U["Staff browser<br/>(Admin / Pharmacist / Assistant)"]

    subgraph APP["Node.js + Express server"]
        V["EJS views<br/>(server-rendered pages)"]
        R["Routes / controllers"]
        S["Services<br/>sale (FEFO), allergy check, alerts"]
        PGD["pg driver<br/>withTransaction()"]
        MGD["mongodb driver"]
    end

    FS[("Local file system<br/>uploads/ (medicine images)")]
    PG[("PostgreSQL 16<br/>staff · suppliers · medicines<br/>stock_lots · sales · sale_items")]
    MG[("MongoDB 7<br/>patient_notes · stock_alerts<br/>audit_logs · notifications")]

    U <-->|HTTP| V
    V --- R
    R --> S
    S --> PGD
    S --> MGD
    R -->|image upload| FS
    PGD <-->|SQL, BEGIN/COMMIT/ROLLBACK| PG
    MGD <-->|documents| MG
```

## Sale flow across both databases

```mermaid
sequenceDiagram
    actor Staff
    participant App as Express app
    participant M as MongoDB
    participant P as PostgreSQL

    Staff->>App: Submit sale (patient, items)
    App->>App: Check role (DANGEROUS / SPECIAL_CONTROLLED → PHARMACIST)
    App->>M: Read patient_notes (allergies)
    alt Allergy match
        App-->>Staff: Block / warn
    end
    App->>P: BEGIN
    App->>P: INSERT sales
    loop each medicine
        App->>P: SELECT lots ... ORDER BY expiry_date FOR UPDATE
        App->>P: UPDATE qty_on_hand, INSERT sale_items (per lot)
    end
    alt Not enough stock
        App->>P: ROLLBACK
        App->>M: INSERT audit_logs (SALE_ROLLED_BACK)
        App-->>Staff: "Insufficient stock"
    else OK
        App->>P: UPDATE sales.total_amount, COMMIT
        App->>M: INSERT audit_logs (SALE_COMMITTED)
        App->>M: INSERT stock_alerts / notifications (if needed)
        App-->>Staff: Receipt
    end
```

Known limitation: the MongoDB writes happen after the SQL commit. If a MongoDB write fails, the sale stands without its log entry.

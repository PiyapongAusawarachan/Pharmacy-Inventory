// The two multi-table transactions of the system: selling (FEFO) and cancelling a bill.
const { withTransaction } = require('../connections/pg');

class SaleError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

// items: [{ medicine_id, quantity }] in base units, already validated and merged.
// Everything below runs in ONE transaction: if any medicine is short, withTransaction()
// issues ROLLBACK and no sale row, sale item or stock change survives.
async function createSale({ staffId, patientCode, customerName, overrideReason, items }) {
  return withTransaction(async (c) => {
    const { rows: saleRows } = await c.query(
      `INSERT INTO sales (staff_id, patient_code, customer_name, override_reason)
       VALUES ($1,$2,$3,$4) RETURNING sale_id, sale_datetime`,
      [staffId, patientCode || null, customerName || null, overrideReason || null]
    );
    const sale = saleRows[0];
    const lines = [];

    // Always lock medicines in the same order so two sales cannot deadlock each other.
    const ordered = [...items].sort((a, b) => a.medicine_id - b.medicine_id);
    for (const item of ordered) {
      const { rows: meds } = await c.query(
        `SELECT medicine_id, generic_name, strength, base_unit, sell_price, reorder_level
           FROM medicines WHERE medicine_id = $1 AND is_active FOR SHARE`,
        [item.medicine_id]
      );
      const med = meds[0];
      if (!med) throw new SaleError('MEDICINE_NOT_FOUND', { medicine_id: item.medicine_id });

      // FEFO: sellable lots, first-expiring first. FOR UPDATE keeps other sales out of these rows.
      const { rows: lots } = await c.query(
        `SELECT lot_id, lot_number, expiry_date, qty_on_hand
           FROM stock_lots
          WHERE medicine_id = $1 AND status = 'ACTIVE' AND qty_on_hand > 0 AND expiry_date > CURRENT_DATE
          ORDER BY expiry_date, received_date, lot_id
            FOR UPDATE`,
        [item.medicine_id]
      );

      let need = item.quantity;
      for (const lot of lots) {
        if (need === 0) break;
        const take = Math.min(need, lot.qty_on_hand);
        await c.query('UPDATE stock_lots SET qty_on_hand = qty_on_hand - $1 WHERE lot_id = $2', [take, lot.lot_id]);
        await c.query(
          `INSERT INTO sale_items (sale_id, medicine_id, lot_id, quantity, unit_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [sale.sale_id, med.medicine_id, lot.lot_id, take, med.sell_price]
        );
        lines.push({
          medicine_id: med.medicine_id, lot_id: lot.lot_id, lot_number: lot.lot_number,
          expiry_date: lot.expiry_date, quantity: take, unit_price: Number(med.sell_price),
        });
        need -= take;
      }

      if (need > 0) {
        // Not enough stock: throwing makes withTransaction() roll back everything above.
        throw new SaleError('INSUFFICIENT_STOCK', {
          medicine_id: med.medicine_id,
          medicine: `${med.generic_name} ${med.strength}`,
          base_unit: med.base_unit,
          requested: item.quantity,
          available: item.quantity - need,
        });
      }
    }

    const { rows: totals } = await c.query(
      `UPDATE sales SET total_amount =
         (SELECT SUM(quantity * unit_price) FROM sale_items WHERE sale_id = $1)
       WHERE sale_id = $1 RETURNING total_amount`,
      [sale.sale_id]
    );
    return { sale_id: sale.sale_id, total: Number(totals[0].total_amount), lines };
  });
}

// Cancel a bill: put every item back into the exact lot it came from, in one transaction.
async function cancelSale(saleId, staffId) {
  return withTransaction(async (c) => {
    const { rows } = await c.query('SELECT sale_id, status FROM sales WHERE sale_id = $1 FOR UPDATE', [saleId]);
    if (!rows[0]) throw new SaleError('SALE_NOT_FOUND');
    if (rows[0].status !== 'COMPLETED') throw new SaleError('ALREADY_CANCELLED');

    const { rows: items } = await c.query(
      'SELECT lot_id, medicine_id, quantity FROM sale_items WHERE sale_id = $1 ORDER BY lot_id',
      [saleId]
    );
    for (const it of items) {
      await c.query('UPDATE stock_lots SET qty_on_hand = qty_on_hand + $1 WHERE lot_id = $2', [it.quantity, it.lot_id]);
    }
    await c.query(
      `UPDATE sales SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = $2 WHERE sale_id = $1`,
      [saleId, staffId]
    );
    return { sale_id: saleId, items };
  });
}

module.exports = { createSale, cancelSale, SaleError };

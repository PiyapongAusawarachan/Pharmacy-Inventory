// Turn PostgreSQL constraint errors into messages a pharmacist can read.
// Keys are constraint names from db/sql/001_schema.sql.
const BY_CONSTRAINT = {
  staff_username_key: 'That username is already taken.',
  suppliers_name_key: 'A supplier with this name already exists.',

  chk_medicines_generic_lower: 'Generic name must be lowercase (join ingredients with +).',
  chk_medicines_drug_class: 'Pick a drug class from the list.',
  chk_medicines_units_per_pack: 'Units per pack must be greater than 0.',
  chk_medicines_sell_price: 'Sell price cannot be negative.',
  chk_medicines_reorder_level: 'Reorder level cannot be negative.',
  chk_medicines_special_rx: 'Specially controlled drugs must be marked as requiring a prescription.',
  uq_medicines_product: 'This medicine (generic name, brand, strength and form) already exists.',

  uq_stock_lots_lot: 'This lot number already exists for this medicine.',
  chk_stock_lots_qty_received: 'Quantity received must be greater than 0.',
  chk_stock_lots_qty_on_hand: 'Quantity on hand must be between 0 and the quantity received.',
  chk_stock_lots_dates: 'Expiry date must be after the manufacture date.',
  chk_stock_lots_unit_cost: 'Unit cost cannot be negative.',
};

// Returns a message, or null if the error is not one we know how to explain
// (caller should rethrow it so it shows up as a real error).
function friendlyDbError(err) {
  if (err.constraint && BY_CONSTRAINT[err.constraint]) return BY_CONSTRAINT[err.constraint];
  switch (err.code) {
    case '23505': return 'This record already exists.';
    case '23514': return 'One of the values is not allowed by the database rules.';
    case '23502': return 'A required field is missing.';
    case '23503': return 'The selected item does not exist or is still in use.';
    case '22P02':
    case '22007':
    case '22008': return 'One of the values has an invalid format (check numbers and dates).';
    case '22003': return 'A number is out of range.';
    default: return null;
  }
}

module.exports = { friendlyDbError };

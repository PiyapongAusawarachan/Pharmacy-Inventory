require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT) || 3000,
  pg: {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'pharmacy',
    password: process.env.PG_PASSWORD || 'pharmacy',
    database: process.env.PG_DATABASE || 'pharmacy',
  },
  mongo: {
    url: process.env.MONGO_URL || 'mongodb://localhost:27017',
    db: process.env.MONGO_DB || 'pharmacy',
  },
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  nearExpiryDays: Number(process.env.NEAR_EXPIRY_DAYS) || 180,
};

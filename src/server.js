const app = require('./app');
const config = require('./config');
const { connectMongo } = require('./db/mongo');

async function start() {
  await connectMongo();
  app.listen(config.port, () => {
    console.log(`Pharmacy Inventory running at http://localhost:${config.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

const { MongoClient } = require('mongodb');
const config = require('../config');

const client = new MongoClient(config.mongo.url);
let db = null;

async function connectMongo() {
  if (!db) {
    await client.connect();
    db = client.db(config.mongo.db);
  }
  return db;
}

function getDb() {
  if (!db) throw new Error('MongoDB not connected yet; call connectMongo() first');
  return db;
}

async function closeMongo() {
  await client.close();
  db = null;
}

module.exports = { connectMongo, getDb, closeMongo };

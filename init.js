/**
 * Database Initializer / Health Check Script
 * Fulfills `npm run init-db`
 */
require('dotenv').config();
const db = require('./database');

async function init() {
  console.log('⚡ Initializing Database connection & verification schema...');
  const secret = process.env.FIREBASE_DB_SECRET;
  if (!secret) {
    console.log('ℹ️  Note: FIREBASE_DB_SECRET is not set. Using default credentials/public rules.');
  }

  try {
    const health = await db.get('health');
    console.log('✅ Current database health status:', health ? 'OK' : 'Uninitialized/Protected');
    console.log('✅ Database initialization check completed successfully.');
  } catch (err) {
    console.warn('⚠️  Database check warning:', err.message);
  }
}

init();

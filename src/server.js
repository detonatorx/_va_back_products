require('dotenv').config();
const { Pool } = require('pg');
const { createApp } = require('./app');
const { migrate } = require('./migrate');

async function start() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) throw new Error('DATABASE_URL или PGHOST обязателен');
  const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  try {
    await migrate(db);
    const app = createApp(db, {
      adminToken: process.env.ADMIN_TOKEN,
      corsOrigins: (process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean)
    });
    const server = app.listen(process.env.PORT || 3001, process.env.HOST || '127.0.0.1', () => {
      console.log(`API слушает порт ${server.address().port}`);
    });
    async function shutdown() {
      server.close(async () => { await db.end(); process.exit(0); });
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    await db.end();
    throw error;
  }
}

start().catch((error) => { console.error(error); process.exitCode = 1; });

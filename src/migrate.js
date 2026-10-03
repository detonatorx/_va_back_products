require('dotenv').config();
const { Pool } = require('pg');

async function migrate(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS dishes (
    id uuid PRIMARY KEY,
    name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
    description varchar(2000) NOT NULL DEFAULT '',
    category varchar(80) NOT NULL DEFAULT '',
    image_url varchar(2048) NOT NULL DEFAULT '',
    price_kopeks integer NOT NULL CHECK (price_kopeks BETWEEN 0 AND 100000000),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

if (require.main === module) {
  const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  migrate(db).then(() => console.log('Миграция выполнена'))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => db.end());
}

module.exports = { migrate };

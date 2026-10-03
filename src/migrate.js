require('dotenv').config();
const { Pool } = require('pg');

async function migrate(db) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(564201)');
    await client.query(`CREATE TABLE IF NOT EXISTS dishes (
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
    await client.query(`CREATE TABLE IF NOT EXISTS dish_photos (
      id uuid PRIMARY KEY,
      dish_id uuid NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      image_data bytea,
      original_image_data bytea,
      external_url varchar(2048) NOT NULL DEFAULT '',
      is_primary boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT photo_source CHECK ((image_data IS NOT NULL AND external_url = '') OR (image_data IS NULL AND external_url <> ''))
    )`);
    await client.query(
      'ALTER TABLE dish_photos ADD COLUMN IF NOT EXISTS original_image_data bytea'
    );
    await client.query(
      'ALTER TABLE dish_photos ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()'
    );
    await client.query(
      'UPDATE dish_photos SET original_image_data=image_data WHERE image_data IS NOT NULL AND original_image_data IS NULL'
    );
    await client.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS dish_photo_primary ON dish_photos (dish_id) WHERE is_primary'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS dish_photo_list ON dish_photos (dish_id, created_at, id)'
    );
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
    const { rowCount } = await client.query(
      "INSERT INTO schema_migrations (name) VALUES ('legacy-photo-links-v1') ON CONFLICT DO NOTHING"
    );
    if (rowCount) {
      await client.query(`INSERT INTO dish_photos (id, dish_id, external_url, is_primary)
        SELECT gen_random_uuid(), d.id, d.image_url, true FROM dishes d
        WHERE d.image_url <> '' AND NOT EXISTS (SELECT 1 FROM dish_photos p WHERE p.dish_id = d.id)`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const db = new Pool(
    process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}
  );
  migrate(db)
    .then(() => console.log('Миграция выполнена'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}

module.exports = { migrate };

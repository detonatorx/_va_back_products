const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const { timingSafeEqual, randomUUID } = require('node:crypto');
const { validateDish } = require('./validation');

const columns =
  'd.id, d.name, d.description, d.category, d.image_url, d.price_kopeks, d.is_active, d.created_at, d.updated_at';
const dishQuery = `SELECT ${columns}, COALESCE((SELECT json_agg(json_build_object(
  'id', p.id, 'url', CASE WHEN p.external_url <> '' THEN p.external_url ELSE '/api/photos/' || p.id::text END,
  'is_primary', p.is_primary) ORDER BY p.is_primary DESC, p.created_at, p.id)
  FROM dish_photos p WHERE p.dish_id = d.id), '[]'::json) AS photos FROM dishes d`;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 3 }
});

async function getDish(db, id) {
  const { rows } = await db.query(`${dishQuery} WHERE d.id=$1`, [id]);
  return rows[0];
}

async function withLockedDish(db, id, operation) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('SELECT id FROM dishes WHERE id=$1 FOR UPDATE', [id]);
    if (!rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createApp(db, { adminToken, corsOrigins = [] }) {
  if (!adminToken || adminToken.length < 16)
    throw new Error('ADMIN_TOKEN должен содержать не менее 16 символов');
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : false }));
  app.use(express.json({ limit: '32kb' }));

  function authorized(req) {
    const token = req.get('authorization')?.replace(/^Bearer /i, '') || '';
    const actual = Buffer.from(token);
    const expected = Buffer.from(adminToken);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  function requireAdmin(req, res, next) {
    if (!authorized(req)) return res.status(401).json({ error: 'Нужен токен администратора' });
    next();
  }

  app.get('/api/health', async (req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.get('/api/dishes', async (req, res) => {
    if (req.get('authorization') && !authorized(req))
      return res.status(401).json({ error: 'Неверный токен' });
    const result = await db.query(
      `${dishQuery} ${authorized(req) ? '' : 'WHERE d.is_active = true'} ORDER BY d.created_at DESC, d.id DESC`
    );
    res.json(result.rows);
  });

  app.post('/api/dishes', requireAdmin, async (req, res) => {
    const { dish, error } = validateDish(req.body);
    if (error) return res.status(400).json({ error });
    const id = randomUUID();
    await db.query(
      `INSERT INTO dishes (id, name, description, category, image_url, price_kopeks, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        dish.name,
        dish.description,
        dish.category,
        dish.image_url,
        dish.price_kopeks,
        dish.is_active
      ]
    );
    res.status(201).json(await getDish(db, id));
  });

  app.put('/api/dishes/:id', requireAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный ID блюда' });
    const { dish, error } = validateDish(req.body);
    if (error) return res.status(400).json({ error });
    const { rowCount } = await db.query(
      `UPDATE dishes SET name=$2, description=$3, category=$4, image_url=$5,
       price_kopeks=$6, is_active=$7, updated_at=now() WHERE id=$1`,
      [
        req.params.id,
        dish.name,
        dish.description,
        dish.category,
        dish.image_url,
        dish.price_kopeks,
        dish.is_active
      ]
    );
    if (!rowCount) return res.status(404).json({ error: 'Блюдо не найдено' });
    res.json(await getDish(db, req.params.id));
  });

  app.get('/api/photos/:id', async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).end();
    const { rows } = await db.query(
      'SELECT image_data FROM dish_photos WHERE id=$1 AND image_data IS NOT NULL',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).end();
    res.type('jpeg').set('Cache-Control', 'public, max-age=3600').send(rows[0].image_data);
  });

  app.post('/api/dishes/:id/photos', requireAdmin, upload.single('photo'), async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный ID блюда' });
    if (!req.file || !['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Выберите фото JPEG, PNG или WebP' });
    }
    let image;
    try {
      const source = sharp(req.file.buffer, { limitInputPixels: 40000000, failOn: 'error' });
      const { format } = await source.metadata();
      if (!['jpeg', 'png', 'webp'].includes(format))
        return res.status(400).json({ error: 'Неподдерживаемый формат фото' });
      image = await source
        .rotate()
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      if (image.length > 2 * 1024 * 1024)
        return res.status(400).json({ error: 'Фото после обработки слишком велико' });
    } catch {
      return res.status(400).json({ error: 'Не удалось обработать фото' });
    }
    const result = await withLockedDish(db, req.params.id, async (client) => {
      const {
        rows: [count]
      } = await client.query('SELECT count(*)::int AS total FROM dish_photos WHERE dish_id=$1', [
        req.params.id
      ]);
      if (count.total >= 10) return 'limit';
      await client.query(
        'INSERT INTO dish_photos (id, dish_id, image_data, is_primary) VALUES ($1, $2, $3, $4)',
        [randomUUID(), req.params.id, image, count.total === 0]
      );
      await client.query('UPDATE dishes SET updated_at=now() WHERE id=$1', [req.params.id]);
      return true;
    });
    if (!result) return res.status(404).json({ error: 'Блюдо не найдено' });
    if (result === 'limit') return res.status(400).json({ error: 'Не более 10 фото на блюдо' });
    res.status(201).json(await getDish(db, req.params.id));
  });

  app.patch('/api/dishes/:id/photos/:photoId/primary', requireAdmin, async (req, res) => {
    if (!isUuid(req.params.id) || !isUuid(req.params.photoId))
      return res.status(400).json({ error: 'Некорректный ID' });
    const result = await withLockedDish(db, req.params.id, async (client) => {
      const photo = await client.query('SELECT id FROM dish_photos WHERE id=$1 AND dish_id=$2', [
        req.params.photoId,
        req.params.id
      ]);
      if (!photo.rowCount) return false;
      await client.query(
        'UPDATE dish_photos SET is_primary=false WHERE dish_id=$1 AND is_primary=true',
        [req.params.id]
      );
      await client.query('UPDATE dish_photos SET is_primary=true WHERE id=$1', [
        req.params.photoId
      ]);
      await client.query('UPDATE dishes SET updated_at=now() WHERE id=$1', [req.params.id]);
      return true;
    });
    if (!result) return res.status(404).json({ error: 'Фото или блюдо не найдено' });
    res.json(await getDish(db, req.params.id));
  });

  app.delete('/api/dishes/:id/photos/:photoId', requireAdmin, async (req, res) => {
    if (!isUuid(req.params.id) || !isUuid(req.params.photoId))
      return res.status(400).json({ error: 'Некорректный ID' });
    const result = await withLockedDish(db, req.params.id, async (client) => {
      const { rows } = await client.query(
        'DELETE FROM dish_photos WHERE id=$1 AND dish_id=$2 RETURNING is_primary',
        [req.params.photoId, req.params.id]
      );
      if (!rows.length) return false;
      if (rows[0].is_primary) {
        await client.query(
          `UPDATE dish_photos SET is_primary=true WHERE id=(
          SELECT id FROM dish_photos WHERE dish_id=$1 ORDER BY created_at, id LIMIT 1)`,
          [req.params.id]
        );
      }
      await client.query('UPDATE dishes SET updated_at=now() WHERE id=$1', [req.params.id]);
      return true;
    });
    if (!result) return res.status(404).json({ error: 'Фото или блюдо не найдено' });
    res.json(await getDish(db, req.params.id));
  });

  app.delete('/api/dishes/:id', requireAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный ID блюда' });
    const result = await db.query('DELETE FROM dishes WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Блюдо не найдено' });
    res.status(204).end();
  });

  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError)
      return res
        .status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ error: 'Превышен размер фото или неверный формат загрузки' });
    if (error instanceof SyntaxError && error.status === 400)
      return res.status(400).json({ error: 'Некорректный JSON' });
    if (error.status === 413) return res.status(413).json({ error: 'Слишком большой запрос' });
    console.error(error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });
  return app;
}

function isUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

module.exports = { createApp };

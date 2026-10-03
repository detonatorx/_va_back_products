const express = require('express');
const cors = require('cors');
const { timingSafeEqual, randomUUID } = require('node:crypto');
const { validateDish } = require('./validation');

const columns = 'id, name, description, category, image_url, price_kopeks, is_active, created_at, updated_at';

function createApp(db, { adminToken, corsOrigins = [] }) {
  if (!adminToken || adminToken.length < 16) throw new Error('ADMIN_TOKEN должен содержать не менее 16 символов');
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
    if (req.get('authorization') && !authorized(req)) return res.status(401).json({ error: 'Неверный токен' });
    const result = await db.query(`SELECT ${columns} FROM dishes ${authorized(req) ? '' : 'WHERE is_active = true'} ORDER BY created_at DESC, id DESC`);
    res.json(result.rows);
  });

  app.post('/api/dishes', requireAdmin, async (req, res) => {
    const { dish, error } = validateDish(req.body);
    if (error) return res.status(400).json({ error });
    const { rows } = await db.query(
      `INSERT INTO dishes (id, name, description, category, image_url, price_kopeks, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${columns}`,
      [randomUUID(), dish.name, dish.description, dish.category, dish.image_url, dish.price_kopeks, dish.is_active]
    );
    res.status(201).json(rows[0]);
  });

  app.put('/api/dishes/:id', requireAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный ID блюда' });
    const { dish, error } = validateDish(req.body);
    if (error) return res.status(400).json({ error });
    const { rows } = await db.query(
      `UPDATE dishes SET name=$2, description=$3, category=$4, image_url=$5,
       price_kopeks=$6, is_active=$7, updated_at=now() WHERE id=$1 RETURNING ${columns}`,
      [req.params.id, dish.name, dish.description, dish.category, dish.image_url, dish.price_kopeks, dish.is_active]
    );
    if (!rows.length) return res.status(404).json({ error: 'Блюдо не найдено' });
    res.json(rows[0]);
  });

  app.delete('/api/dishes/:id', requireAdmin, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Некорректный ID блюда' });
    const result = await db.query('DELETE FROM dishes WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Блюдо не найдено' });
    res.status(204).end();
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Некорректный JSON' });
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

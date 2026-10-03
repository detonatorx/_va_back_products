const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createApp } = require('../src/app');
const { migrate } = require('../src/migrate');

const token = 'test-admin-token-123456789';
const dish = { name: 'Борщ', description: 'Со сметаной', category: 'Супы', image_url: '', price_kopeks: 32000, is_active: false };

test('CRUD, публичная видимость и защита записи', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await migrate(db);
  const server = createApp(db, { adminToken: token }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/dishes`;
  const auth = { authorization: `Bearer ${token}` };
  let id;
  try {
    const send = (url, method, body, headers = auth) => fetch(url, {
      method, headers: { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    assert.equal((await send(base, 'POST', dish, {})).status, 401);
    assert.equal((await send(base, 'POST', { ...dish, price_kopeks: -1 })).status, 400);
    const created = await send(base, 'POST', dish);
    assert.equal(created.status, 201);
    id = (await created.json()).id;
    assert.equal((await (await fetch(base)).json()).some((item) => item.id === id), false);
    assert.equal((await (await fetch(base, { headers: auth })).json()).some((item) => item.id === id), true);
    assert.equal((await fetch(base, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const updated = await send(`${base}/${id}`, 'PUT', { ...dish, is_active: true, price_kopeks: 40000 });
    assert.equal((await updated.json()).price_kopeks, 40000);
    assert.equal((await (await fetch(base)).json()).some((item) => item.id === id), true);
    assert.equal((await send(`${base}/${id}`, 'DELETE')).status, 204);
    id = null;
  } finally {
    if (id) await db.query('DELETE FROM dishes WHERE id=$1', [id]);
    await new Promise((resolve) => server.close(resolve));
    await db.end();
  }
});

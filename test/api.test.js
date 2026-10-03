const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createApp } = require('../src/app');
const { migrate } = require('../src/migrate');

const token = 'test-admin-token-123456789';
const dish = {
  name: 'Борщ',
  description: 'Со сметаной',
  category: 'Супы',
  image_url: '',
  price_kopeks: 32000,
  is_active: false
};

test(
  'CRUD, публичная видимость и защита записи',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await migrate(db);
    const server = createApp(db, { adminToken: token }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/dishes`;
    const auth = { authorization: `Bearer ${token}` };
    let id;
    try {
      const send = (url, method, body, headers = auth) =>
        fetch(url, {
          method,
          headers: { ...headers, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      assert.equal((await send(base, 'POST', dish, {})).status, 401);
      assert.equal((await send(base, 'POST', { ...dish, price_kopeks: -1 })).status, 400);
      const created = await send(base, 'POST', dish);
      assert.equal(created.status, 201);
      id = (await created.json()).id;
      assert.equal(
        (await (await fetch(base)).json()).some((item) => item.id === id),
        false
      );
      assert.equal(
        (await (await fetch(base, { headers: auth })).json()).some((item) => item.id === id),
        true
      );
      assert.equal((await fetch(base, { headers: { authorization: 'Bearer wrong' } })).status, 401);
      const updated = await send(`${base}/${id}`, 'PUT', {
        ...dish,
        is_active: true,
        price_kopeks: 40000
      });
      assert.equal((await updated.json()).price_kopeks, 40000);
      assert.equal(
        (await (await fetch(base)).json()).some((item) => item.id === id),
        true
      );
      assert.equal((await send(`${base}/${id}`, 'DELETE')).status, 204);
      id = null;
    } finally {
      if (id) await db.query('DELETE FROM dishes WHERE id=$1', [id]);
      await new Promise((resolve) => server.close(resolve));
      await db.end();
    }
  }
);

test(
  'фото блюда: загрузка, порядок, главное, удаление и права доступа',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const sharp = require('sharp');
    const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await migrate(db);
    const server = createApp(db, { adminToken: token }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const auth = { authorization: `Bearer ${token}` };
    const image = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#cc6622' }
    })
      .png()
      .toBuffer();
    let id;
    const upload = (content, headers = auth) => {
      const form = new FormData();
      form.append('photo', new Blob([content], { type: 'image/png' }), 'photo.png');
      return fetch(`${base}/dishes/${id}/photos`, { method: 'POST', headers, body: form });
    };
    try {
      const created = await fetch(`${base}/dishes`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ ...dish, is_active: true })
      });
      id = (await created.json()).id;
      assert.equal((await upload(image, {})).status, 401);
      assert.equal((await upload(Buffer.from('not an image'))).status, 400);
      const first = await upload(image);
      assert.equal(first.status, 201, await first.clone().text());
      const firstPhoto = (await first.json()).photos[0];
      assert.equal(firstPhoto.is_primary, true);
      const second = await upload(image);
      assert.equal(second.status, 201);
      const secondPhoto = (await second.json()).photos[1];
      assert.equal(secondPhoto.is_primary, false);
      const binary = await fetch(`${new URL(base).origin}${firstPhoto.url}`);
      assert.equal(binary.status, 200);
      assert.equal(binary.headers.get('content-type'), 'image/jpeg');
      assert.equal(
        (await sharp(Buffer.from(await binary.arrayBuffer())).metadata()).format,
        'jpeg'
      );
      const primaryUrl = `${base}/dishes/${id}/photos/${secondPhoto.id}/primary`;
      assert.equal((await fetch(primaryUrl, { method: 'PATCH' })).status, 401);
      const selected = await fetch(primaryUrl, { method: 'PATCH', headers: auth });
      assert.equal((await selected.json()).photos[0].id, secondPhoto.id);
      const listed = await (await fetch(`${base}/dishes`)).json();
      assert.equal(listed.find((item) => item.id === id).photos[0].id, secondPhoto.id);
      const removed = await fetch(`${base}/dishes/${id}/photos/${secondPhoto.id}`, {
        method: 'DELETE',
        headers: auth
      });
      assert.equal((await removed.json()).photos[0].id, firstPhoto.id);
      assert.equal((await fetch(`${base}/photos/${secondPhoto.id}`)).status, 404);
      assert.equal(
        (
          await fetch(`${base}/dishes/${id}/photos/${firstPhoto.id}`, {
            method: 'DELETE',
            headers: auth
          })
        ).status,
        200
      );
      assert.equal(
        (await (await fetch(`${base}/dishes`, { headers: auth })).json()).find(
          (item) => item.id === id
        ).photos.length,
        0
      );
      for (let i = 0; i < 10; i++) assert.equal((await upload(image)).status, 201);
      assert.equal((await upload(image)).status, 400);
      assert.equal((await upload(Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
    } finally {
      if (id) await db.query('DELETE FROM dishes WHERE id=$1', [id]);
      await new Promise((resolve) => server.close(resolve));
      await db.end();
    }
  }
);

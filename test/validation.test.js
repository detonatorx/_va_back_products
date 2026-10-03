const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateDish } = require('../src/validation');

const valid = { name: '  Борщ  ', description: '', category: 'Супы', image_url: '', price_kopeks: 35000, is_active: true };

test('нормализует название и принимает цену в копейках', () => {
  assert.equal(validateDish(valid).dish.name, 'Борщ');
  assert.equal(validateDish({ ...valid, price_kopeks: 0 }).dish.price_kopeks, 0);
});

test('отвергает некорректные и лишние поля', () => {
  for (const value of [null, {}, { ...valid, price_kopeks: 1.5 }, { ...valid, image_url: 'javascript:alert(1)' }, { ...valid, stock: 10 }]) {
    assert.ok(validateDish(value).error);
  }
});

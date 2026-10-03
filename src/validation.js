const fields = ['name', 'description', 'category', 'image_url', 'price_kopeks', 'is_active'];

function validateDish(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !fields.includes(key)) ||
      fields.some((key) => !Object.hasOwn(value, key))) {
    return { error: 'Передайте все поля блюда без дополнительных полей' };
  }

  const { name, description, category, image_url, price_kopeks, is_active } = value;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
      typeof description !== 'string' || description.length > 2000 ||
      typeof category !== 'string' || category.length > 80 ||
      typeof image_url !== 'string' || image_url.length > 2048 ||
      !Number.isInteger(price_kopeks) || price_kopeks < 0 || price_kopeks > 100000000 ||
      typeof is_active !== 'boolean') {
    return { error: 'Проверьте название, описание, категорию, цену и видимость блюда' };
  }
  if (image_url) {
    try {
      if (!['https:', 'http:'].includes(new URL(image_url).protocol)) {
        return { error: 'Фото должно быть ссылкой http или https' };
      }
    } catch {
      return { error: 'Укажите корректную ссылку на фото' };
    }
  }
  return { dish: {
    name: name.trim(), description: description.trim(), category: category.trim(),
    image_url, price_kopeks, is_active
  } };
}

module.exports = { validateDish };

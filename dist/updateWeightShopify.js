const axios = require("axios");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config();



async function getProductData(productId) {
  const connection = await mysql.createConnection({
    host: process.env.host,
    user: process.env.user,
    database: process.env.database,
    password: process.env.password,
  });

  const [rows] = await connection.execute(
    `
    SELECT 
      MAX(CASE WHEN specifications_id = 751 THEN specification END) AS sku,
      MAX(CASE WHEN specifications_id = 766 THEN specification END) AS weight
    FROM products_specifications
    WHERE products_id = ?;
    `,
    [productId]
  );

  await connection.end();
  return rows[0];
}

async function updateShopifyWeightBySku(sku, newWeight) {
  const productsRes = await axios.get(
    `https://${process.env.SHOPIFY_US_STORE}.myshopify.com/admin/api/2025-07/products.json?limit=250`,
    {
      headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_US_ACCESS_TOKEN },
    }
  );

  const product = productsRes.data.products.find((p) =>
    p.variants.some((v) => v.sku === sku)
  );

  if (!product) {
    throw new Error(`Продукт с SKU ${sku} не найден`);
  }

  // Конвертируем вес в фунты и устанавливаем единицу измерения
  const weightInPounds = newWeight;
  
  const updatedVariants = product.variants.map((variant) =>
    variant.sku === sku
      ? { 
          id: variant.id, 
          weight: weightInPounds, 
          weight_unit: "lb" // устанавливаем фунты как единицу измерения
        }
      : { id: variant.id }
  );

  await axios.put(
    `https://${process.env.SHOPIFY_US_STORE}.myshopify.com/admin/api/2025-07/products/${product.id}.json`,
    { product: { id: product.id, variants: updatedVariants } },
    { headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_US_ACCESS_TOKEN } }
  );

  console.log(`Вес продукта с SKU ${sku} обновлён на ${weightInPounds} lb (было ${newWeight} кг)`);
}

async function getAllProductIds() {
  const connection = await mysql.createConnection({
    host: process.env.host,
    user: process.env.user,
    database: process.env.database,
    password: process.env.password,
  });

  const [rows] = await connection.execute(
    `SELECT DISTINCT products_id FROM products_specifications`
  );

  await connection.end();
  return rows.map((row) => row.products_id);
}

// Основной цикл
(async () => {
  const productIds = await getAllProductIds();
  const failedProducts = [];
  let skippedProducts = 0;
  let updatedProducts = 0;

  for (const productId of productIds) {
    try {
      const data = await getProductData(productId);

      // Проверяем, что SKU существует
      if (!data.sku) {
        console.log(`Продукт ${productId} не имеет SKU, пропускаем`);
        skippedProducts++;
        continue;
      }

      // Проверяем, что вес существует и не равен 0
      if (!data.weight || parseFloat(data.weight) === 0) {
        console.log(`Продукт ${productId} (SKU: ${data.sku}) не имеет веса или вес равен 0, пропускаем`);
        skippedProducts++;
        continue;
      }

      await updateShopifyWeightBySku(data.sku, data.weight);
      updatedProducts++;
      
    } catch (err) {
      console.error(`Ошибка для продукта ${productId}: ${err.message}`);
      failedProducts.push({  reason: err.message });
    }
  }

  if (failedProducts.length) {
    fs.writeFileSync("failed_products_us.log", JSON.stringify(failedProducts, null, 2));
    console.log(`Лог ошибок записан в failed_products_us.log`);
  }

  console.log(`\n=== ОТЧЕТ ===`);
  console.log(`Всего продуктов обработано: ${productIds.length}`);
  console.log(`Успешно обновлено: ${updatedProducts}`);
  console.log(`Пропущено: ${skippedProducts}`);
  console.log(`Ошибок: ${failedProducts.length}`);
  console.log("Обновление всех продуктов завершено");
})();
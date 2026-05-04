const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

dotenv.config();

function getDbConfig() {
  const { host, user, database, password } = process.env;

  if (!host || !user || !database) {
    throw new Error("Не хватает конфигурации БД. Укажите host, user, database, password в .env");
  }

  return { host, user, database, password };
}

async function withDbConnection(fn) {
  const connection = await mysql.createConnection(getDbConfig());

  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

async function fetchSourceRows(connection, { sourceLanguageId, specificationId }) {
  const [rows] = await connection.execute(
    `
      SELECT
        ps.products_id,
        ps.language_id,
        ps.specification,
        ps.specifications_id
      FROM products_specifications ps
      INNER JOIN (
        SELECT
          products_id,
          specifications_id,
          language_id,
          MAX(products_specification_id) AS max_id
        FROM products_specifications
        WHERE language_id = ? AND specifications_id = ?
        GROUP BY products_id, specifications_id, language_id
      ) latest
        ON latest.max_id = ps.products_specification_id
    `,
    [sourceLanguageId, specificationId]
  );

  return rows;
}

async function fetchLatestTargetSpecificationsMap(connection, {
  targetLanguageId,
  specificationId,
}) {
  const [rows] = await connection.execute(
    `
      SELECT
        ps.products_id,
        ps.specification
      FROM products_specifications ps
      INNER JOIN (
        SELECT
          products_id,
          MAX(products_specification_id) AS max_id
        FROM products_specifications
        WHERE language_id = ?
          AND specifications_id = ?
        GROUP BY products_id
      ) latest
        ON latest.max_id = ps.products_specification_id
    `,
    [targetLanguageId, specificationId]
  );

  return new Map(
    rows
      .map((row) => [Number(row.products_id), row.specification])
      .filter(([id]) => Number.isInteger(id) && id > 0)
  );
}

async function fetchCurrentSpecificationValuesByProduct(connection, {
  languageId,
  specificationId,
}) {
  const [rows] = await connection.execute(
    `
      SELECT
        ps.products_id,
        ps.specification
      FROM products_specifications ps
      INNER JOIN (
        SELECT
          products_id,
          specification,
          MAX(products_specification_id) AS max_id
        FROM products_specifications
        WHERE language_id = ?
          AND specifications_id = ?
        GROUP BY products_id, specification
      ) latest
        ON latest.max_id = ps.products_specification_id
    `,
    [languageId, specificationId]
  );

  const byProduct = new Map();
  for (const row of rows) {
    const productId = Number(row.products_id);
    if (!Number.isInteger(productId) || productId <= 0) {
      continue;
    }

    const value = row.specification === null || row.specification === undefined
      ? ""
      : String(row.specification).trim();
    if (!value) {
      continue;
    }

    const current = byProduct.get(productId) || [];
    if (!current.includes(value)) {
      current.push(value);
    }
    byProduct.set(productId, current);
  }

  return byProduct;
}

async function upsertSpecification(connection, {
  productId,
  languageId,
  specification,
  specificationId,
}) {
  const [updateResult] = await connection.execute(
    `
      UPDATE products_specifications
      SET specification = ?
      WHERE products_id = ? AND language_id = ? AND specifications_id = ?
    `,
    [specification, productId, languageId, specificationId]
  );

  if (updateResult.affectedRows > 0) {
    return;
  }

  await connection.execute(
    `
      INSERT INTO products_specifications
        (products_id, language_id, specification, specifications_id)
      VALUES (?, ?, ?, ?)
    `,
    [productId, languageId, specification, specificationId]
  );
}

async function replaceSpecificationValues(connection, {
  productId,
  languageId,
  specificationId,
  values,
}) {
  await connection.execute(
    `
      DELETE FROM products_specifications
      WHERE products_id = ? AND language_id = ? AND specifications_id = ?
    `,
    [productId, languageId, specificationId]
  );

  for (const value of values) {
    await connection.execute(
      `
        INSERT INTO products_specifications
          (products_id, language_id, specification, specifications_id)
        VALUES (?, ?, ?, ?)
      `,
      [productId, languageId, value, specificationId]
    );
  }
}

module.exports = {
  withDbConnection,
  fetchSourceRows,
  fetchLatestTargetSpecificationsMap,
  fetchCurrentSpecificationValuesByProduct,
  upsertSpecification,
  replaceSpecificationValues,
};

const {
  COUNTRY_BY_LANGUAGE_ID,
  TRANSFER_SPEC_IDS,
  TRANSFER_SPEC_LABELS,
  TRANSFER_GROUP_LABELS,
  TRANSFER_GROUP_ORDER,
  TRANSFER_SPEC_GROUPS,
  LOAD_SPEC_IDS,
  HEIGHT_SPEC_IDS,
  MATERIAL_TRANSLATIONS,
  COLOR_TRANSLATIONS,
  COLOR_OPTION_VALUES,
  MATERIAL_OPTION_VALUES,
  SPEC_IDS,
  VESA_OPTION_VALUES,
  SCREEN_COUNT_OPTION_VALUES,
} = require("../config/specs");
const { withDbConnection, upsertSpecification, replaceSpecificationValues } = require("./db");
const {
  parseNumber,
  formatQuarterFraction,
  transformNumericTokens,
  stripMillimeterUnits,
  normalizeDimensionSeparators,
  normalizeVolumeToM3,
} = require("./numbers");

const ALL_TARGETS = "all";
const DEFAULT_TRANSFER_GROUP_KEY = "other";
const US_LANGUAGE_ID = 2;
const KG_TO_POUNDS = Number(process.env.KG_TO_POUNDS_FACTOR || 2.2);
const MM_TO_INCH = Number(process.env.MM_TO_INCH_FACTOR || 0.04);
const M3_TO_FT3 = Number(process.env.M3_TO_FT3_FACTOR || 35.31);
const VOLUME_FT3_DECIMALS = Math.max(
  0,
  Math.min(10, Number(process.env.VOLUME_FT3_DECIMALS || 6))
);
const VOLUME_RAW_TO_M3_THRESHOLD = Number(
  process.env.VOLUME_RAW_TO_M3_THRESHOLD || 1000
);
const VOLUME_RAW_TO_M3_DIVISOR = Number(
  process.env.VOLUME_RAW_TO_M3_DIVISOR || 1000000
);
const PRODUCT_IMAGE_BASE_URL = String(
  process.env.PRODUCT_IMAGE_BASE_URL ||
    "https://shop.onkron.ru/images/product_images/info_images"
).trim();
const TRANSFER_GROUP_ORDER_INDEX = new Map(
  TRANSFER_GROUP_ORDER.map((groupKey, index) => [groupKey, index])
);
const LOAD_SPEC_ID_SET = new Set(
  (Array.isArray(LOAD_SPEC_IDS) ? LOAD_SPEC_IDS : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)
);
const HEIGHT_SPEC_ID_SET = new Set(
  (Array.isArray(HEIGHT_SPEC_IDS) ? HEIGHT_SPEC_IDS : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)
);
const EXTRA_WEIGHT_SPEC_ID_SET = new Set([766, 767]);
const EXTRA_MM_SPEC_ID_SET = new Set([68, 760, 762]);
const EXTRA_VOLUME_SPEC_ID_SET = new Set([763]);
const KG_TO_LBS_SPEC_ID_SET = new Set([
  ...LOAD_SPEC_ID_SET,
  ...EXTRA_WEIGHT_SPEC_ID_SET,
]);
const MM_TO_INCH_SPEC_ID_SET = new Set([
  ...HEIGHT_SPEC_ID_SET,
  ...EXTRA_MM_SPEC_ID_SET,
]);
const DIMENSION_SPEC_ID_SET = new Set([68, 760, 762]);
const M3_TO_FT3_SPEC_ID_SET = new Set([...EXTRA_VOLUME_SPEC_ID_SET]);
const MULTI_VALUE_SPEC_ID_SET = new Set([
  SPEC_IDS.vesa || 24,
  SPEC_IDS.color,
  SPEC_IDS.material,
]);

function translateColorValue(value, { sourceLanguageId, targetLanguageId }) {
  const targetDictionary = COLOR_TRANSLATIONS[targetLanguageId];
  if (!targetDictionary) {
    return value;
  }

  if (sourceLanguageId === US_LANGUAGE_ID) {
    return value;
  }

  return targetDictionary[value] || null;
}

function translateMaterialValue(value, { sourceLanguageId, targetLanguageId }) {
  const targetDictionary = MATERIAL_TRANSLATIONS[targetLanguageId];
  if (!targetDictionary) {
    return value;
  }

  if (sourceLanguageId === 1) {
    return targetDictionary[value] || null;
  }

  return value;
}

function normalizeInt(value, { name, min = 1 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`Некорректное значение ${name || "числа"}: ${value}`);
  }
  return parsed;
}

function normalizeSpecIds(specIds) {
  const source = Array.isArray(specIds) ? specIds : TRANSFER_SPEC_IDS;
  const normalized = source
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (normalized.length === 0) {
    throw new Error("Не переданы корректные spec id для переноса");
  }

  return [...new Set(normalized)];
}

function getSpecLabel(specificationId) {
  return TRANSFER_SPEC_LABELS[specificationId] || `spec-${specificationId}`;
}

function getSpecGroupMeta(specificationId) {
  const groupKey =
    TRANSFER_SPEC_GROUPS[specificationId] || DEFAULT_TRANSFER_GROUP_KEY;
  const groupLabel =
    TRANSFER_GROUP_LABELS[groupKey] ||
    TRANSFER_GROUP_LABELS[DEFAULT_TRANSFER_GROUP_KEY] ||
    "Прочее";
  const groupOrder = TRANSFER_GROUP_ORDER_INDEX.has(groupKey)
    ? TRANSFER_GROUP_ORDER_INDEX.get(groupKey)
    : TRANSFER_GROUP_ORDER_INDEX.get(DEFAULT_TRANSFER_GROUP_KEY) ?? 999;

  return {
    groupKey,
    groupLabel,
    groupOrder,
  };
}

function isMultiValueSpecId(specificationId) {
  return MULTI_VALUE_SPEC_ID_SET.has(Number(specificationId));
}

function normalizeValueArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = [];
  for (const rawValue of values) {
    const value = rawValue === null || rawValue === undefined
      ? ""
      : String(rawValue).trim();
    if (!value || unique.includes(value)) {
      continue;
    }
    unique.push(value);
  }

  return unique;
}

function mergeValueArrays(...lists) {
  const merged = [];
  for (const list of lists) {
    for (const value of normalizeValueArray(list)) {
      if (!merged.includes(value)) {
        merged.push(value);
      }
    }
  }
  return merged;
}

function normalizeOptionEntries(options) {
  const unique = [];
  for (const option of Array.isArray(options) ? options : []) {
    const value = String(option?.value || "").trim();
    const label = String(option?.label || value).trim();
    if (!value || unique.some((item) => item.value === value)) {
      continue;
    }
    unique.push({ value, label });
  }
  return unique;
}

async function fetchProductSpecificationEntries(connection, {
  languageId,
  productId,
  specIds,
}) {
  const normalizedLanguageId = normalizeInt(languageId, { name: "language id" });
  const normalizedProductId = normalizeInt(productId, { name: "product id" });
  const ids = normalizeSpecIds(specIds);
  const multiValueSpecIds = ids.filter((id) => isMultiValueSpecId(id));
  const singleValueSpecIds = ids.filter((id) => !isMultiValueSpecId(id));
  const entriesBySpecId = new Map();

  if (singleValueSpecIds.length > 0) {
    const [rows] = await connection.execute(
      `
        SELECT
          ps.specifications_id,
          ps.specification
        FROM products_specifications ps
        INNER JOIN (
          SELECT
            specifications_id,
            MAX(products_specification_id) AS max_id
          FROM products_specifications
          WHERE language_id = ?
            AND products_id = ?
            AND specifications_id IN (${singleValueSpecIds.map(() => "?").join(", ")})
          GROUP BY specifications_id
        ) latest
          ON latest.max_id = ps.products_specification_id
        ORDER BY specifications_id
      `,
      [normalizedLanguageId, normalizedProductId, ...singleValueSpecIds]
    );

    for (const row of rows) {
      const specificationId = Number(row.specifications_id);
      const value = row.specification === null || row.specification === undefined
        ? ""
        : String(row.specification).trim();
      entriesBySpecId.set(specificationId, normalizeValueArray([value]));
    }
  }

  if (multiValueSpecIds.length > 0) {
    const [rows] = await connection.execute(
      `
        SELECT
          ps.specifications_id,
          ps.specification
        FROM products_specifications ps
        INNER JOIN (
          SELECT
            specifications_id,
            specification,
            MAX(products_specification_id) AS max_id
          FROM products_specifications
          WHERE language_id = ?
            AND products_id = ?
            AND specifications_id IN (${multiValueSpecIds.map(() => "?").join(", ")})
          GROUP BY specifications_id, specification
        ) latest
          ON latest.max_id = ps.products_specification_id
        ORDER BY ps.specifications_id, ps.products_specification_id DESC
      `,
      [normalizedLanguageId, normalizedProductId, ...multiValueSpecIds]
    );

    for (const row of rows) {
      const specificationId = Number(row.specifications_id);
      const currentValues = entriesBySpecId.get(specificationId) || [];
      const mergedValues = mergeValueArrays(currentValues, [row.specification]);
      entriesBySpecId.set(specificationId, mergedValues);
    }
  }

  const entries = [];
  for (const specificationId of ids) {
    if (!entriesBySpecId.has(specificationId)) {
      continue;
    }

    const values = normalizeValueArray(entriesBySpecId.get(specificationId));
    const groupMeta = getSpecGroupMeta(specificationId);

    entries.push({
      specificationId,
      label: getSpecLabel(specificationId),
      values,
      value: values.join(", "),
      isMultiValue: isMultiValueSpecId(specificationId),
      ...groupMeta,
    });
  }

  entries.sort((a, b) => {
    if (a.groupOrder !== b.groupOrder) {
      return a.groupOrder - b.groupOrder;
    }

    return a.specificationId - b.specificationId;
  });

  return entries;
}

function getEditorFieldType(specificationId) {
  if (Number(specificationId) === 753) {
    return "choice";
  }

  return isMultiValueSpecId(specificationId) ? "multi" : "text";
}

function buildEditableOptions({
  specificationId,
  sourceValues,
  currentValues,
  targetLanguageId,
}) {
  const merged = mergeValueArrays(sourceValues, currentValues);

  if (specificationId === SPEC_IDS.color) {
    if (targetLanguageId === 1) {
      return normalizeOptionEntries(
        mergeValueArrays(COLOR_OPTION_VALUES, merged).map((value) => ({
          value,
          label: value,
        }))
      );
    }

    const dictionary = COLOR_TRANSLATIONS[targetLanguageId] || null;
    const translatedBaseOptions = COLOR_OPTION_VALUES.map((value) => ({
      value: dictionary?.[value] || value,
      label: dictionary?.[value] || value,
    }));
    const currentTranslatedOptions = currentValues.map((value) => ({
      value,
      label: value,
    }));
    return normalizeOptionEntries([
      ...translatedBaseOptions,
      ...currentTranslatedOptions,
    ]);
  }

  if (specificationId === SPEC_IDS.material) {
    if (targetLanguageId === 1) {
      return normalizeOptionEntries(
        mergeValueArrays(MATERIAL_OPTION_VALUES, merged).map((value) => ({
          value,
          label: value,
        }))
      );
    }

    const dictionary = MATERIAL_TRANSLATIONS[targetLanguageId] || null;
    const translatedBaseOptions = MATERIAL_OPTION_VALUES.map((value) => ({
      value: dictionary?.[value] || value,
      label: dictionary?.[value] || value,
    }));
    const currentTranslatedOptions = currentValues.map((value) => ({
      value,
      label: value,
    }));
    return normalizeOptionEntries([
      ...translatedBaseOptions,
      ...currentTranslatedOptions,
    ]);
  }

  if (Number(specificationId) === Number(SPEC_IDS.vesa || 24)) {
    return normalizeOptionEntries(
      mergeValueArrays(VESA_OPTION_VALUES, merged).map((value) => ({
        value,
        label: value,
      }))
    );
  }

  if (Number(specificationId) === 753) {
    return normalizeOptionEntries(
      mergeValueArrays(SCREEN_COUNT_OPTION_VALUES, merged).map((value) => ({
        value,
        label: value,
      }))
    );
  }

  return normalizeOptionEntries(
    merged.map((value) => ({ value, label: value }))
  );
}

function resolveTargetLanguageIds(sourceLanguageId, targetLanguageId) {
  if (
    targetLanguageId !== ALL_TARGETS &&
    targetLanguageId !== null &&
    targetLanguageId !== undefined
  ) {
    return [normalizeInt(targetLanguageId, { name: "target language id" })];
  }

  const targetIds = Object.keys(COUNTRY_BY_LANGUAGE_ID)
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id !== sourceLanguageId)
    .sort((a, b) => a - b);

  if (targetIds.length === 0) {
    throw new Error("Нет доступных языков назначения для переноса");
  }

  return targetIds;
}

function buildProductImageUrl(rawImage) {
  const image = rawImage === null || rawImage === undefined
    ? ""
    : String(rawImage).trim();
  if (!image) {
    return null;
  }

  if (/^https?:\/\//i.test(image)) {
    return image;
  }

  const normalizedBase = PRODUCT_IMAGE_BASE_URL.replace(/\/+$/, "");
  if (!normalizedBase) {
    return null;
  }

  const normalizedImage = image.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedImage}`;
}

function normalizeProductStatus(rawStatus) {
  const status = Number(rawStatus);
  if (status === 1) {
    return 1;
  }

  if (status === 0) {
    return 0;
  }

  return null;
}

function stripCubicMeterUnits(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const normalized = String(rawValue)
    .replace(/\s*(?:м3|м\^3|m3|m\^3|куб\.?\s*м(?:етр(?:а|ов)?)?)/giu, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return normalized || null;
}

function stripCubicFootUnits(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  const normalized = String(rawValue)
    .replace(/\s*(?:ft3|ft\^3|cu\.?\s*ft|cft)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return normalized || null;
}

function formatVolumeValue(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (VOLUME_FT3_DECIMALS === 0) {
    return String(Math.round(value));
  }

  return value
    .toFixed(VOLUME_FT3_DECIMALS)
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");
}

function mapProductMetaFromRow(row, productId) {
  const name = row?.products_name ? String(row.products_name).trim() : "";
  const model = row?.products_model ? String(row.products_model).trim() : "";
  const productName = name || model || `Товар #${productId}`;

  return {
    productName,
    productModel: model || null,
    productImageUrl: buildProductImageUrl(row?.products_image),
    productStatus: normalizeProductStatus(row?.products_status),
  };
}

async function fetchTransferProductMeta(connection, { productId, languageId }) {
  try {
    const [rows] = await connection.execute(
      `
        SELECT
          MAX(pd.products_name) AS products_name,
          MAX(p.products_model) AS products_model,
          MAX(p.products_image) AS products_image,
          MAX(p.products_status) AS products_status
        FROM products p
        LEFT JOIN products_description pd
          ON pd.products_id = p.products_id
          AND pd.language_id = ?
        WHERE p.products_id = ?
      `,
      [languageId, productId]
    );

    const row = rows[0] || {};
    return mapProductMetaFromRow(row, productId);
  } catch (error) {
    const noMetaTables =
      error &&
      (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_FIELD_ERROR");
    if (!noMetaTables) {
      throw error;
    }

    return {
      productName: `Товар #${productId}`,
      productModel: null,
      productImageUrl: null,
      productStatus: null,
    };
  }
}

function transformTransferValue({
  specificationId,
  sourceValue,
  sourceLanguageId,
  targetLanguageId,
}) {
  const value =
    sourceValue === null || sourceValue === undefined
      ? ""
      : String(sourceValue).trim();

  if (!value) {
    return null;
  }

  if (specificationId === SPEC_IDS.color) {
    return translateColorValue(value, { sourceLanguageId, targetLanguageId });
  }

  if (specificationId === SPEC_IDS.material) {
    return translateMaterialValue(value, { sourceLanguageId, targetLanguageId });
  }

  if (KG_TO_LBS_SPEC_ID_SET.has(specificationId)) {
    if (sourceLanguageId === US_LANGUAGE_ID && targetLanguageId !== US_LANGUAGE_ID) {
      return transformNumericTokens(value, (lbsValue) => lbsValue / KG_TO_POUNDS);
    }

    if (targetLanguageId === US_LANGUAGE_ID) {
      return transformNumericTokens(value, (kgValue) =>
        formatQuarterFraction(kgValue * KG_TO_POUNDS)
      );
    }

    return value;
  }

  if (MM_TO_INCH_SPEC_ID_SET.has(specificationId)) {
    if (sourceLanguageId === US_LANGUAGE_ID && targetLanguageId !== US_LANGUAGE_ID) {
      const converted = transformNumericTokens(value, (inchValue) => inchValue / MM_TO_INCH);
      if (!converted) {
        return null;
      }

      if (DIMENSION_SPEC_ID_SET.has(specificationId)) {
        return normalizeDimensionSeparators(converted);
      }

      return converted;
    }

    if (targetLanguageId === US_LANGUAGE_ID) {
      const converted = transformNumericTokens(value, (mmValue) =>
        formatQuarterFraction(mmValue * MM_TO_INCH)
      );
      const withoutUnits = stripMillimeterUnits(converted);
      if (!withoutUnits) {
        return null;
      }

      if (DIMENSION_SPEC_ID_SET.has(specificationId)) {
        return normalizeDimensionSeparators(withoutUnits);
      }

      return withoutUnits;
    }

    if (DIMENSION_SPEC_ID_SET.has(specificationId)) {
      return normalizeDimensionSeparators(value);
    }

    return value;
  }

  if (M3_TO_FT3_SPEC_ID_SET.has(specificationId)) {
    const numericVolume = parseNumber(value);
    if (numericVolume === null) {
      return null;
    }

    if (sourceLanguageId === US_LANGUAGE_ID && targetLanguageId !== US_LANGUAGE_ID) {
      const normalizedUs = stripCubicFootUnits(value) || value;
      const usVolume = parseNumber(normalizedUs);
      if (usVolume === null) {
        return null;
      }
      return formatVolumeValue(usVolume / M3_TO_FT3);
    }

    if (targetLanguageId === US_LANGUAGE_ID) {
      const normalizedM3 = normalizeVolumeToM3(numericVolume, {
        largeValueThreshold: VOLUME_RAW_TO_M3_THRESHOLD,
        largeValueDivisor: VOLUME_RAW_TO_M3_DIVISOR,
      });
      if (normalizedM3 === null) {
        return null;
      }

      const ft3Value = formatVolumeValue(normalizedM3 * M3_TO_FT3);
      if (!ft3Value) {
        return null;
      }

      return `${ft3Value} ft³`;
    }

    return value;
  }

  return value;
}

async function listTransferProducts({
  sourceLanguageId = 1,
  specIds = TRANSFER_SPEC_IDS,
  search = "",
  limit = 120,
}) {
  const langId = normalizeInt(sourceLanguageId, { name: "source language id" });
  const normalizedLimit = Math.min(
    Math.max(normalizeInt(limit || 120, { name: "limit" }), 1),
    500
  );
  const ids = normalizeSpecIds(specIds);
  const trimmedSearch = String(search || "").trim();

  return withDbConnection(async (connection) => {
    const wildcard = `%${trimmedSearch}%`;

    const buildSimpleResult = async () => {
      const params = [langId, ...ids];
      let query = `
        SELECT DISTINCT products_id
        FROM products_specifications
        WHERE language_id = ?
          AND specifications_id IN (${ids.map(() => "?").join(", ")})
      `;

      if (trimmedSearch) {
        query += " AND CAST(products_id AS CHAR) LIKE ?";
        params.push(wildcard);
      }

      query += " ORDER BY products_id DESC LIMIT ?";
      params.push(normalizedLimit);

      const [rows] = await connection.execute(query, params);
      return rows
        .map((row) => Number(row.products_id))
        .filter((id) => Number.isInteger(id) && id > 0)
        .map((id) => ({
          id,
          label: `Товар #${id}`,
          name: null,
          model: null,
          ean: null,
          imageUrl: null,
          status: null,
        }));
    };

    try {
      const params = [langId, langId, ...ids];
      let query = `
        SELECT
          ps.products_id,
          MAX(pd.products_name) AS products_name,
          MAX(p.products_model) AS products_model,
          MAX(p.products_ean) AS products_ean,
          MAX(p.products_image) AS products_image,
          MAX(p.products_status) AS products_status
        FROM products_specifications ps
        LEFT JOIN products_description pd
          ON pd.products_id = ps.products_id
          AND pd.language_id = ?
        LEFT JOIN products p
          ON p.products_id = ps.products_id
        WHERE ps.language_id = ?
          AND ps.specifications_id IN (${ids.map(() => "?").join(", ")})
      `;

      if (trimmedSearch) {
        query += `
          AND (
            CAST(ps.products_id AS CHAR) LIKE ?
            OR COALESCE(pd.products_name, "") LIKE ?
            OR COALESCE(p.products_model, "") LIKE ?
            OR COALESCE(CAST(p.products_ean AS CHAR), "") LIKE ?
          )
        `;
        params.push(wildcard, wildcard, wildcard, wildcard);
      }

      query += `
        GROUP BY ps.products_id
        ORDER BY ps.products_id DESC
        LIMIT ?
      `;
      params.push(normalizedLimit);

      const [rows] = await connection.execute(query, params);
      const mapped = rows
        .map((row) => {
          const id = Number(row.products_id);
          if (!Number.isInteger(id) || id <= 0) {
            return null;
          }

          const name = row.products_name ? String(row.products_name).trim() : "";
          const model = row.products_model ? String(row.products_model).trim() : "";
          const ean = row.products_ean ? String(row.products_ean).trim() : "";
          const labelBase = name || `Товар #${id}`;
          const label = model ? `${labelBase} (${model})` : labelBase;

          return {
            id,
            label,
            name: name || null,
            model: model || null,
            ean: ean || null,
            imageUrl: buildProductImageUrl(row.products_image),
            status: normalizeProductStatus(row.products_status),
          };
        })
        .filter(Boolean);

      if (mapped.length > 0 || !trimmedSearch) {
        return mapped;
      }

      return buildSimpleResult();
    } catch (error) {
      const noMetaTables =
        error &&
        (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_FIELD_ERROR");
      if (!noMetaTables) {
        throw error;
      }

      return buildSimpleResult();
    }
  });
}

async function getTransferProductSpecifications({
  sourceLanguageId = 1,
  productId,
  specIds = TRANSFER_SPEC_IDS,
}) {
  const langId = normalizeInt(sourceLanguageId, { name: "source language id" });
  const normalizedProductId = normalizeInt(productId, { name: "product id" });
  const ids = normalizeSpecIds(specIds);

  return withDbConnection(async (connection) => {
    return fetchProductSpecificationEntries(connection, {
      languageId: langId,
      productId: normalizedProductId,
      specIds: ids,
    });
  });
}

async function getEditableProductSpecifications({
  sourceLanguageId = 1,
  languageId,
  productId,
  specIds = TRANSFER_SPEC_IDS,
}) {
  const normalizedSourceLanguageId = normalizeInt(sourceLanguageId, {
    name: "source language id",
  });
  const normalizedLanguageId = normalizeInt(languageId, { name: "language id" });
  const normalizedProductId = normalizeInt(productId, { name: "product id" });
  const ids = normalizeSpecIds(specIds);

  return withDbConnection(async (connection) => {
    const [productMeta, sourceEntries, currentEntries] = await Promise.all([
      fetchTransferProductMeta(connection, {
        productId: normalizedProductId,
        languageId: normalizedSourceLanguageId,
      }),
      fetchProductSpecificationEntries(connection, {
        languageId: normalizedSourceLanguageId,
        productId: normalizedProductId,
        specIds: ids,
      }),
      fetchProductSpecificationEntries(connection, {
        languageId: normalizedLanguageId,
        productId: normalizedProductId,
        specIds: ids,
      }),
    ]);

    const sourceBySpecId = new Map(
      sourceEntries.map((entry) => [Number(entry.specificationId), entry])
    );
    const currentBySpecId = new Map(
      currentEntries.map((entry) => [Number(entry.specificationId), entry])
    );
    const combinedSpecIds = ids.filter(
      (specificationId) =>
        sourceBySpecId.has(specificationId) || currentBySpecId.has(specificationId)
    );

    const specifications = combinedSpecIds.map((specificationId) => {
      const sourceEntry = sourceBySpecId.get(specificationId) || null;
      const currentEntry = currentBySpecId.get(specificationId) || null;
      const groupMeta = getSpecGroupMeta(specificationId);
      const sourceValues = normalizeValueArray(sourceEntry?.values || []);
      const currentValues = normalizeValueArray(currentEntry?.values || []);
      const fieldType = getEditorFieldType(specificationId);

      return {
        specificationId,
        label: getSpecLabel(specificationId),
        fieldType,
        isMultiValue: fieldType === "multi",
        value: currentValues[0] || "",
        values: currentValues,
        sourceValue: sourceValues[0] || "",
        sourceValues,
        options:
          fieldType !== "text"
            ? buildEditableOptions({
                specificationId,
                sourceValues,
                currentValues,
                targetLanguageId: normalizedLanguageId,
              })
            : [],
        ...groupMeta,
      };
    });

    specifications.sort((a, b) => {
      if (a.groupOrder !== b.groupOrder) {
        return a.groupOrder - b.groupOrder;
      }

      return a.specificationId - b.specificationId;
    });

    return {
      productId: normalizedProductId,
      languageId: normalizedLanguageId,
      sourceLanguageId: normalizedSourceLanguageId,
      productName: productMeta.productName,
      productModel: productMeta.productModel,
      productImageUrl: productMeta.productImageUrl,
      productStatus: productMeta.productStatus,
      specifications,
    };
  });
}

async function saveEditableProductSpecifications({
  productId,
  languageId,
  specs = [],
}) {
  const normalizedProductId = normalizeInt(productId, { name: "product id" });
  const normalizedLanguageId = normalizeInt(languageId, { name: "language id" });
  const normalizedSpecs = Array.isArray(specs) ? specs : [];

  if (normalizedSpecs.length === 0) {
    return {
      taskName: "edit-product-specifications",
      productId: normalizedProductId,
      languageId: normalizedLanguageId,
      total: 0,
      updated: 0,
      failed: 0,
      specIds: [],
    };
  }

  return withDbConnection(async (connection) => {
    const productMeta = await fetchTransferProductMeta(connection, {
      productId: normalizedProductId,
      languageId: 1,
    });

    const stats = {
      taskName: "edit-product-specifications",
      productId: normalizedProductId,
      productName: productMeta.productName,
      languageId: normalizedLanguageId,
      total: normalizedSpecs.length,
      updated: 0,
      failed: 0,
      specIds: [],
    };

    await connection.beginTransaction();

    try {
      for (const spec of normalizedSpecs) {
        const specificationId = normalizeInt(spec?.specificationId, {
          name: "specification id",
        });
        const values = isMultiValueSpecId(specificationId)
          ? normalizeValueArray(spec?.values || [])
          : normalizeValueArray([spec?.value || ""]);

        await replaceSpecificationValues(connection, {
          productId: normalizedProductId,
          languageId: normalizedLanguageId,
          specificationId,
          values,
        });

        stats.updated += 1;
        stats.specIds.push(specificationId);
      }

      await connection.commit();
      return stats;
    } catch (error) {
      await connection.rollback();
      stats.failed = normalizedSpecs.length;
      throw error;
    }
  });
}

async function transferSelectedProductSpecifications({
  sourceLanguageId = 1,
  targetLanguageId = ALL_TARGETS,
  productId,
  specIds = TRANSFER_SPEC_IDS,
  dryRun = false,
  onProgress = null,
}) {
  const langId = normalizeInt(sourceLanguageId, { name: "source language id" });
  const normalizedProductId = normalizeInt(productId, { name: "product id" });
  const selectedSpecIds = normalizeSpecIds(specIds);
  const targetLanguageIds = resolveTargetLanguageIds(langId, targetLanguageId);
  const multiValueSpecIds = selectedSpecIds.filter((id) =>
    MULTI_VALUE_SPEC_ID_SET.has(Number(id))
  );
  const singleValueSpecIds = selectedSpecIds.filter(
    (id) => !MULTI_VALUE_SPEC_ID_SET.has(Number(id))
  );

  return withDbConnection(async (connection) => {
    let sourceRows = [];
    if (singleValueSpecIds.length > 0) {
      const [singleRows] = await connection.execute(
        `
          SELECT
            ps.products_id,
            ps.specifications_id,
            ps.specification
          FROM products_specifications ps
          INNER JOIN (
            SELECT
              specifications_id,
              MAX(products_specification_id) AS max_id
            FROM products_specifications
            WHERE language_id = ?
              AND products_id = ?
              AND specifications_id IN (${singleValueSpecIds.map(() => "?").join(", ")})
            GROUP BY specifications_id
          ) latest
            ON latest.max_id = ps.products_specification_id
        `,
        [langId, normalizedProductId, ...singleValueSpecIds]
      );
      sourceRows = sourceRows.concat(singleRows);
    }

    if (multiValueSpecIds.length > 0) {
      const [multiRows] = await connection.execute(
        `
          SELECT
            ps.products_id,
            ps.specifications_id,
            ps.specification
          FROM products_specifications ps
          INNER JOIN (
            SELECT
              specifications_id,
              specification,
              MAX(products_specification_id) AS max_id
            FROM products_specifications
            WHERE language_id = ?
              AND products_id = ?
              AND specifications_id IN (${multiValueSpecIds.map(() => "?").join(", ")})
            GROUP BY specifications_id, specification
          ) latest
            ON latest.max_id = ps.products_specification_id
        `,
        [langId, normalizedProductId, ...multiValueSpecIds]
      );
      sourceRows = sourceRows.concat(multiRows);
    }

    const stats = {
      taskName: "transfer-selected-specifications",
      productId: normalizedProductId,
      productName: `Товар #${normalizedProductId}`,
      productModel: null,
      productImageUrl: null,
      sourceLanguageId: langId,
      targetLanguageId: targetLanguageIds.length === 1 ? targetLanguageIds[0] : ALL_TARGETS,
      targetLanguageIds,
      specIds: selectedSpecIds,
      total: sourceRows.length * targetLanguageIds.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      dryRun: Boolean(dryRun),
      details: [],
    };
    let done = 0;

    const notifyProgress = () => {
      if (typeof onProgress !== "function") {
        return;
      }

      onProgress({
        scope: "transfer",
        taskName: stats.taskName,
        productId: normalizedProductId,
        done,
        total: stats.total,
        updated: stats.updated,
        skipped: stats.skipped,
        failed: stats.failed,
      });
    };

    const meta = await fetchTransferProductMeta(connection, {
      productId: normalizedProductId,
      languageId: langId,
    });
    stats.productName = meta.productName;
    stats.productModel = meta.productModel;
    stats.productImageUrl = meta.productImageUrl;
    notifyProgress();

    for (const targetId of targetLanguageIds) {
      const targetStat = {
        targetLanguageId: targetId,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      const multiValuesBySpecId = new Map();

      for (const row of sourceRows) {
        const specificationId = Number(row.specifications_id);
        if (MULTI_VALUE_SPEC_ID_SET.has(specificationId)) {
          const transformedValue = transformTransferValue({
            specificationId,
            sourceValue: row.specification,
            sourceLanguageId: langId,
            targetLanguageId: targetId,
          });

          if (
            transformedValue === null ||
            transformedValue === undefined ||
            String(transformedValue).trim() === ""
          ) {
            stats.skipped += 1;
            targetStat.skipped += 1;
            done += 1;
            notifyProgress();
            continue;
          }

          const values = multiValuesBySpecId.get(specificationId) || [];
          if (!values.includes(transformedValue)) {
            values.push(transformedValue);
          }
          multiValuesBySpecId.set(specificationId, values);
          continue;
        }

        const transformedValue = transformTransferValue({
          specificationId,
          sourceValue: row.specification,
          sourceLanguageId: langId,
          targetLanguageId: targetId,
        });

        if (
          transformedValue === null ||
          transformedValue === undefined ||
          String(transformedValue).trim() === ""
        ) {
          stats.skipped += 1;
          targetStat.skipped += 1;
          done += 1;
          notifyProgress();
          continue;
        }

        try {
          if (!dryRun) {
            await upsertSpecification(connection, {
              productId: Number(row.products_id),
              languageId: targetId,
              specification: transformedValue,
              specificationId,
            });
          }

          stats.updated += 1;
          targetStat.updated += 1;
        } catch (error) {
          stats.failed += 1;
          targetStat.failed += 1;
        } finally {
          done += 1;
          notifyProgress();
        }
      }

      for (const [specificationId, values] of multiValuesBySpecId.entries()) {
        try {
          if (!dryRun) {
            await replaceSpecificationValues(connection, {
              productId: normalizedProductId,
              languageId: targetId,
              specificationId,
              values,
            });
          }

          stats.updated += values.length;
          targetStat.updated += values.length;
        } catch (error) {
          stats.failed += values.length;
          targetStat.failed += values.length;
        } finally {
          done += values.length;
          notifyProgress();
        }
      }

      stats.details.push(targetStat);
    }

    return stats;
  });
}

module.exports = {
  ALL_TARGETS,
  listTransferProducts,
  getTransferProductSpecifications,
  getEditableProductSpecifications,
  saveEditableProductSpecifications,
  transferSelectedProductSpecifications,
};

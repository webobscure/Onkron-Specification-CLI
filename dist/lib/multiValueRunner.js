const {
  withDbConnection,
  fetchCurrentSpecificationValuesByProduct,
  replaceSpecificationValues,
} = require("./db");

function normalizeValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = [];
  for (const raw of values) {
    const value = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!value || unique.includes(value)) {
      continue;
    }
    unique.push(value);
  }
  return unique;
}

function areEqualSets(a, b) {
  const left = normalizeValues(a).slice().sort();
  const right = normalizeValues(b).slice().sort();
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function isSubsetSet(subset, superset) {
  const left = new Set(normalizeValues(subset));
  const right = new Set(normalizeValues(superset));
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

async function runMultiValueSpecificationUpdate({
  taskName,
  sourceLanguageId = 1,
  targetLanguageId,
  specificationId,
  transformValue,
  dryRun = false,
  onProgress = null,
  overwriteFilledTargets = false,
  allowUpdateIfTargetEqualsSource = false,
  allowUpdateIfTargetSubsetOfTransformed = false,
}) {
  if (
    !taskName ||
    !targetLanguageId ||
    !specificationId ||
    typeof transformValue !== "function"
  ) {
    throw new Error("Некорректная конфигурация задачи");
  }

  return withDbConnection(async (connection) => {
    const sourceByProduct = await fetchCurrentSpecificationValuesByProduct(connection, {
      languageId: sourceLanguageId,
      specificationId,
    });
    const targetByProduct = await fetchCurrentSpecificationValuesByProduct(connection, {
      languageId: targetLanguageId,
      specificationId,
    });

    const productIds = [...sourceByProduct.keys()].sort((a, b) => a - b);
    const stats = {
      taskName,
      sourceLanguageId,
      targetLanguageId,
      specificationId,
      total: productIds.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      dryRun: Boolean(dryRun),
    };
    let done = 0;

    const notifyProgress = () => {
      if (typeof onProgress !== "function") {
        return;
      }

      onProgress({
        scope: "task",
        taskName,
        sourceLanguageId,
        targetLanguageId,
        specificationId,
        done,
        total: stats.total,
        updated: stats.updated,
        skipped: stats.skipped,
        failed: stats.failed,
      });
    };

    notifyProgress();

    for (const productId of productIds) {
      const sourceValues = normalizeValues(sourceByProduct.get(productId) || []);
      const targetValues = normalizeValues(targetByProduct.get(productId) || []);
      const transformedValues = normalizeValues(
        sourceValues.map((value) => transformValue(value))
      );

      if (transformedValues.length === 0) {
        stats.skipped += 1;
        done += 1;
        notifyProgress();
        continue;
      }

      const targetAlreadyFilled = targetValues.length > 0;
      const canRewriteFilledTarget =
        allowUpdateIfTargetEqualsSource && areEqualSets(targetValues, sourceValues);
      const canCompleteFilledTarget =
        allowUpdateIfTargetSubsetOfTransformed &&
        targetValues.length > 0 &&
        transformedValues.length > targetValues.length &&
        isSubsetSet(targetValues, transformedValues);

      if (
        targetAlreadyFilled &&
        !overwriteFilledTargets &&
        !canRewriteFilledTarget &&
        !canCompleteFilledTarget
      ) {
        stats.skipped += 1;
        done += 1;
        notifyProgress();
        continue;
      }

      try {
        if (!dryRun) {
          await replaceSpecificationValues(connection, {
            productId,
            languageId: targetLanguageId,
            specificationId,
            values: transformedValues,
          });
        }

        targetByProduct.set(productId, transformedValues);
        stats.updated += 1;
      } catch (error) {
        stats.failed += 1;
        console.error(
          `[${taskName}] Ошибка для товара ${productId}: ${error.message}`
        );
      } finally {
        done += 1;
        notifyProgress();
      }
    }

    return stats;
  });
}

module.exports = {
  runMultiValueSpecificationUpdate,
};

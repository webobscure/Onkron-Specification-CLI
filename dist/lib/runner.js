const {
  withDbConnection,
  fetchSourceRows,
  fetchLatestTargetSpecificationsMap,
  upsertSpecification,
} = require("./db");
const TASK_NAME_LABELS = {
  material: "Материал",
  color: "Цвет",
  height: "Высота",
  load: "Нагрузка",
  autofill: "Автозаполнение",
  all: "Все задачи",
  "update-material": "Обновление материала",
  "update-color": "Обновление цвета",
  "update-vesa-repair": "Восстановление VESA",
  "transfer-selected-specifications": "Перенос выбранных спецификаций",
};

function getTaskLabel(taskName) {
  const key = String(taskName || "").trim();
  return TASK_NAME_LABELS[key] || key || "-";
}

async function runSpecificationUpdate({
  taskName,
  sourceLanguageId = 1,
  targetLanguageId,
  specificationId,
  transform,
  dryRun = false,
  onProgress = null,
  allowUpdateIfTargetEqualsSource = false,
  overwriteFilledTargets = false,
}) {
  if (!taskName || !targetLanguageId || !specificationId || typeof transform !== "function") {
    throw new Error("Некорректная конфигурация задачи");
  }

  return withDbConnection(async (connection) => {
    const rows = await fetchSourceRows(connection, {
      sourceLanguageId,
      specificationId,
    });

    const stats = {
      taskName,
      sourceLanguageId,
      targetLanguageId,
      specificationId,
      total: rows.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      dryRun,
    };
    const targetSpecificationByProductId = await fetchLatestTargetSpecificationsMap(connection, {
      targetLanguageId,
      specificationId,
    });
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

    for (const row of rows) {
      try {
        const productId = Number(row.products_id);
        const targetRaw = targetSpecificationByProductId.get(productId);
        const targetValue = targetRaw === null || targetRaw === undefined
          ? ""
          : String(targetRaw).trim();
        const sourceValue = row.specification === null || row.specification === undefined
          ? ""
          : String(row.specification).trim();
        const targetAlreadyFilled = targetValue !== "";
        const canUpdateFilledTarget =
          allowUpdateIfTargetEqualsSource &&
          targetAlreadyFilled &&
          targetValue === sourceValue;

        if (targetAlreadyFilled && !overwriteFilledTargets && !canUpdateFilledTarget) {
          stats.skipped += 1;
          continue;
        }

        const transformed = transform(row);
        if (transformed === null || transformed === undefined || transformed === "") {
          stats.skipped += 1;
          continue;
        }

        if (!dryRun) {
          await upsertSpecification(connection, {
            productId,
            languageId: targetLanguageId,
            specification: transformed,
            specificationId,
          });
        }

        targetSpecificationByProductId.set(productId, transformed);
        stats.updated += 1;
      } catch (error) {
        stats.failed += 1;
        console.error(
          `[${taskName}] Ошибка для товара ${row.products_id}: ${error.message}`
        );
      } finally {
        done += 1;
        notifyProgress();
      }
    }

    return stats;
  });
}

function printStats(stats) {
  console.log("\n=== ОТЧЕТ ===");
  console.log(`Задача: ${getTaskLabel(stats.taskName)}`);
  console.log(`Исходный язык: ${stats.sourceLanguageId}`);
  console.log(`Язык назначения: ${stats.targetLanguageId}`);
  console.log(`ID спецификации: ${stats.specificationId}`);
  console.log(`Всего: ${stats.total}`);
  console.log(`Обновлено: ${stats.updated}`);
  console.log(`Пропущено: ${stats.skipped}`);
  console.log(`Ошибок: ${stats.failed}`);
  console.log(`Режим: ${stats.dryRun ? "тестовый (dry-run)" : "запись"}`);
}

module.exports = {
  runSpecificationUpdate,
  printStats,
};

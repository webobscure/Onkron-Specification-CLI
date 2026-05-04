#!/usr/bin/env node

const readline = require("readline");
const {
  COUNTRY_BY_LANGUAGE_ID,
  AUTOFILL_SPEC_IDS,
  HEIGHT_SPEC_IDS,
  LOAD_SPEC_IDS,
} = require("./config/specs");
const { printStats } = require("./lib/runner");
const { sendBitrixChangeLog } = require("./lib/bitrixLogger");
const {
  updateMaterial,
  updateColor,
  updateHeight,
  updateLoad,
  updateAutofill,
  updateVesaRepair,
} = require("./tasks");
const ALL_TARGETS = "all";

const HELP = `
VamShop CLI Спецификаций

Использование:
  node dist/cli.js                     Запуск интерактивного меню
  node dist/cli.js run <task> [flags] Прямой запуск задачи

Задачи:
  material
  color
  height
  load
  autofill
  vesa-repair
  all

Флаги:
  --lang <id|all>          Язык назначения для material (2..8) или все языки
  --material-lang <id|all> Синоним --lang в задаче all
  --target-lang <id|all>   Язык назначения для color/height/load/autofill/vesa-repair (по умолчанию: all)
  --source-lang <id>       Исходный язык (по умолчанию: 1)
  --dry-run                Проверка и отчет без записи в БД
  --help                   Показать эту справку

Примеры:
  node dist/cli.js run material --lang 3
  node dist/cli.js run material --lang all
  node dist/cli.js run autofill --target-lang all
  node dist/cli.js run vesa-repair --target-lang all
  node dist/cli.js run load --target-lang 2 --dry-run
  node dist/cli.js run all --material-lang all --target-lang all
`;

function parseLanguageSelection(value, { allowAll = false } = {}) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (allowAll && normalized === ALL_TARGETS) {
    return ALL_TARGETS;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Некорректное значение языка: ${value}`);
  }

  return parsed;
}

function resolveTargetLanguages(sourceLanguageId, targetSelection) {
  if (targetSelection !== ALL_TARGETS && targetSelection !== null && targetSelection !== undefined) {
    return [Number(targetSelection)];
  }

  const allTargets = Object.keys(COUNTRY_BY_LANGUAGE_ID)
    .map((languageId) => Number(languageId))
    .filter((languageId) => Number.isInteger(languageId))
    .filter((languageId) => languageId !== sourceLanguageId)
    .sort((a, b) => a - b);

  if (allTargets.length === 0) {
    throw new Error("Для выбранного исходного языка нет доступных языков назначения");
  }

  return allTargets;
}

function collapseStats(stats) {
  return stats.length === 1 ? stats[0] : stats;
}

function countAutofillSpecs() {
  return Array.isArray(AUTOFILL_SPEC_IDS) ? AUTOFILL_SPEC_IDS.length : 0;
}

function countHeightSpecs() {
  return Array.isArray(HEIGHT_SPEC_IDS) ? HEIGHT_SPEC_IDS.length : 0;
}

function countLoadSpecs() {
  return Array.isArray(LOAD_SPEC_IDS) ? LOAD_SPEC_IDS.length : 0;
}

function getRunPlan(task, flags) {
  const sourceLanguageId = Number(flags?.sourceLanguageId) || 1;
  const materialTargets = resolveTargetLanguages(
    sourceLanguageId,
    flags?.materialLanguageId
  ).length;
  const commonTargets = resolveTargetLanguages(
    sourceLanguageId,
    flags?.targetLanguageId
  ).length;

  const stagesByTask = {
    material: materialTargets,
    color: commonTargets,
    height: commonTargets * countHeightSpecs(),
    load: commonTargets * countLoadSpecs(),
    autofill: commonTargets * countAutofillSpecs(),
    "vesa-repair": commonTargets,
  };

  if (task === "all") {
    return {
      task,
      stageTotal:
        stagesByTask.material +
        stagesByTask.color +
        stagesByTask.height +
        stagesByTask.load +
        stagesByTask.autofill,
      stagesByTask,
    };
  }

  return {
    task,
    stageTotal: stagesByTask[task] || 0,
    stagesByTask,
  };
}

async function logCliRunToBitrix({ task, flags, result }) {
  const stats = Array.isArray(result) ? result : [result];
  await sendBitrixChangeLog({
    channel: "cli-task",
    task,
    dryRun: Boolean(flags?.dryRun),
    user: "cli",
    sourceLanguageId: flags?.sourceLanguageId,
    targetLanguageId: flags?.targetLanguageId,
    stats,
  });
}

async function runAcrossTargets(taskRunner, {
  sourceLanguageId,
  targetSelection,
  dryRun,
  onProgress = null,
}) {
  const targetLanguages = resolveTargetLanguages(sourceLanguageId, targetSelection);
  const stats = [];

  for (const targetLanguageId of targetLanguages) {
    const result = await taskRunner({
      sourceLanguageId,
      targetLanguageId,
      dryRun,
      onProgress,
    });

    if (Array.isArray(result)) {
      stats.push(...result);
    } else {
      stats.push(result);
    }
  }

  return collapseStats(stats);
}

function parseArgs(argv) {
  const args = [...argv];
  const flags = {
    dryRun: false,
    sourceLanguageId: 1,
    targetLanguageId: ALL_TARGETS,
    materialLanguageId: ALL_TARGETS,
  };

  let command = null;
  let task = null;

  while (args.length > 0) {
    const token = args.shift();

    if (token === "run") {
      command = "run";
      task = args.shift() || null;
      continue;
    }

    if (token === "--help" || token === "-h") {
      command = "help";
      continue;
    }

    if (token === "--dry-run") {
      flags.dryRun = true;
      continue;
    }

    if (token === "--lang" || token === "--material-lang") {
      const parsedMaterial = parseLanguageSelection(args.shift(), { allowAll: true });
      if (parsedMaterial === null) {
        throw new Error(`Не указано значение для ${token}`);
      }
      flags.materialLanguageId = parsedMaterial;
      continue;
    }

    if (token === "--target-lang") {
      const parsedTarget = parseLanguageSelection(args.shift(), { allowAll: true });
      if (parsedTarget === null) {
        throw new Error("Не указано значение для --target-lang");
      }
      flags.targetLanguageId = parsedTarget;
      continue;
    }

    if (token === "--source-lang") {
      const parsedSource = parseLanguageSelection(args.shift());
      if (parsedSource === null) {
        throw new Error("Не указано значение для --source-lang");
      }
      flags.sourceLanguageId = parsedSource;
      continue;
    }

    if (!command && ["material", "color", "height", "load", "autofill", "vesa-repair", "all"].includes(token)) {
      command = "run";
      task = token;
      continue;
    }

    throw new Error(`Неизвестный аргумент: ${token}`);
  }

  return { command, task, flags };
}

async function runTask(task, flags, options = {}) {
  const onProgress = typeof options.onProgress === "function"
    ? options.onProgress
    : null;

  switch (task) {
    case "material": {
      return runAcrossTargets(updateMaterial, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.materialLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
    }
    case "color": {
      return runAcrossTargets(updateColor, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
    }
    case "height": {
      return runAcrossTargets(updateHeight, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
    }
    case "load": {
      return runAcrossTargets(updateLoad, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
    }
    case "autofill": {
      return runAcrossTargets(updateAutofill, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
    }
    case "vesa-repair": {
      return runAcrossTargets(updateVesaRepair, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
    }
    case "all": {
      const stats = [];
      const materialStats = await runAcrossTargets(updateMaterial, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.materialLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
      stats.push(
        ...(Array.isArray(materialStats) ? materialStats : [materialStats])
      );
      const colorStats = await runAcrossTargets(updateColor, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
      stats.push(
        ...(Array.isArray(colorStats) ? colorStats : [colorStats])
      );
      const heightStats = await runAcrossTargets(updateHeight, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
      stats.push(
        ...(Array.isArray(heightStats) ? heightStats : [heightStats])
      );
      const loadStats = await runAcrossTargets(updateLoad, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
      stats.push(
        ...(Array.isArray(loadStats) ? loadStats : [loadStats])
      );
      const autofillStats = await runAcrossTargets(updateAutofill, {
        sourceLanguageId: flags.sourceLanguageId,
        targetSelection: flags.targetLanguageId,
        dryRun: flags.dryRun,
        onProgress,
      });
      stats.push(
        ...(Array.isArray(autofillStats) ? autofillStats : [autofillStats])
      );

      return stats;
    }
    default:
      throw new Error(`Неизвестная задача: ${task}`);
  }
}

function printCountries() {
  console.log("\nДоступные страны/языки:");
  for (const [languageId, countryCode] of Object.entries(COUNTRY_BY_LANGUAGE_ID)) {
    console.log(`  ${languageId}: ${countryCode}`);
  }
}

function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

async function runInteractive() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("VamShop CLI Спецификаций\n");
    console.log("1) Обновить материал");
    console.log("2) Обновить цвет");
    console.log("3) Обновить высоту");
    console.log("4) Обновить нагрузку");
    console.log("5) Обновить автозаполнение");
    console.log("6) Восстановить VESA");
    console.log("7) Запустить все задачи");
    console.log("0) Выход\n");

    const selection = await ask(rl, "Выберите действие: ");

    if (selection === "0") {
      console.log("Выход");
      return;
    }

    const flags = {
      dryRun: false,
      sourceLanguageId: 1,
      targetLanguageId: ALL_TARGETS,
      materialLanguageId: ALL_TARGETS,
    };

    const dryRunAnswer = (await ask(rl, "Тестовый запуск без записи? (y/N): ")).toLowerCase();
    flags.dryRun =
      dryRunAnswer === "y" ||
      dryRunAnswer === "yes" ||
      dryRunAnswer === "д" ||
      dryRunAnswer === "да";

    const sourceLanguage = await ask(rl, "ID исходного языка [1]: ");
    if (sourceLanguage) {
      const parsedSource = parseLanguageSelection(sourceLanguage);
      if (parsedSource === null) {
        throw new Error("Нужно указать ID исходного языка");
      }
      flags.sourceLanguageId = parsedSource;
    }

    let task;
    if (selection === "1") {
      task = "material";
      printCountries();
      const materialLang = await ask(rl, "ID языка назначения для материала [all]: ");
      if (materialLang) {
        flags.materialLanguageId = parseLanguageSelection(materialLang, {
          allowAll: true,
        });
      }
    } else if (selection === "2") {
      task = "color";
      const target = await ask(rl, "ID языка назначения [all]: ");
      if (target) {
        flags.targetLanguageId = parseLanguageSelection(target, {
          allowAll: true,
        });
      }
    } else if (selection === "3") {
      task = "height";
      const target = await ask(rl, "ID языка назначения [all]: ");
      if (target) {
        flags.targetLanguageId = parseLanguageSelection(target, {
          allowAll: true,
        });
      }
    } else if (selection === "4") {
      task = "load";
      const target = await ask(rl, "ID языка назначения [all]: ");
      if (target) {
        flags.targetLanguageId = parseLanguageSelection(target, {
          allowAll: true,
        });
      }
    } else if (selection === "5") {
      task = "autofill";
      const target = await ask(rl, "ID языка назначения [all]: ");
      if (target) {
        flags.targetLanguageId = parseLanguageSelection(target, {
          allowAll: true,
        });
      }
    } else if (selection === "6") {
      task = "vesa-repair";
      const target = await ask(rl, "ID языка назначения [all]: ");
      if (target) {
        flags.targetLanguageId = parseLanguageSelection(target, {
          allowAll: true,
        });
      }
    } else if (selection === "7") {
      task = "all";
      printCountries();
      const materialLang = await ask(rl, "ID языка назначения для материала [all]: ");
      if (materialLang) {
        flags.materialLanguageId = parseLanguageSelection(materialLang, {
          allowAll: true,
        });
      }
      const target = await ask(
        rl,
        "Язык назначения для color/height/load/autofill [all]: "
      );
      if (target) {
        flags.targetLanguageId = parseLanguageSelection(target, {
          allowAll: true,
        });
      }
    } else {
      throw new Error("Выбрано некорректное действие");
    }

    const result = await runTask(task, flags);
    await logCliRunToBitrix({ task, flags, result });
    if (Array.isArray(result)) {
      result.forEach((item) => printStats(item));
    } else {
      printStats(result);
    }
  } finally {
    rl.close();
  }
}

async function main() {
  try {
    const { command, task, flags } = parseArgs(process.argv.slice(2));

    if (command === "help") {
      console.log(HELP);
      return;
    }

    if (command === "run") {
      if (!task) {
        throw new Error("Не указана задача. Используйте: node dist/cli.js run <task>");
      }

      const result = await runTask(task, flags);
      await logCliRunToBitrix({ task, flags, result });
      if (Array.isArray(result)) {
        result.forEach((item) => printStats(item));
      } else {
        printStats(result);
      }
      return;
    }

    await runInteractive();
  } catch (error) {
    console.error(`Ошибка: ${error.message}`);
    console.log("Используйте --help для примеров запуска.");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArgs,
  runTask,
  getRunPlan,
};

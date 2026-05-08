const { COLOR_TRANSLATIONS, SPEC_IDS } = require("../config/specs");
const { runMultiValueSpecificationUpdate } = require("../lib/multiValueRunner");

async function updateColor({
  targetLanguageId = 2,
  sourceLanguageId = 1,
  dryRun = false,
  onProgress = null,
}) {
  const dictionary = COLOR_TRANSLATIONS[targetLanguageId];
  if (!dictionary) {
    throw new Error(`Нет словаря цветов для language_id=${targetLanguageId}`);
  }

  return runMultiValueSpecificationUpdate({
    taskName: "update-color",
    sourceLanguageId,
    targetLanguageId,
    specificationId: SPEC_IDS.color,
    dryRun,
    onProgress,
    allowUpdateIfTargetEqualsSource: true,
    allowUpdateIfTargetSubsetOfTransformed: true,
    transformValue: (value) => dictionary[value] || null,
  });
}

module.exports = {
  updateColor,
};

const { MATERIAL_TRANSLATIONS, SPEC_IDS } = require("../config/specs");
const { runMultiValueSpecificationUpdate } = require("../lib/multiValueRunner");

async function updateMaterial({
  targetLanguageId,
  sourceLanguageId = 1,
  dryRun = false,
  onProgress = null,
}) {
  const dictionary = MATERIAL_TRANSLATIONS[targetLanguageId];
  if (!dictionary) {
    throw new Error(`Нет словаря материалов для language_id=${targetLanguageId}`);
  }

  return runMultiValueSpecificationUpdate({
    taskName: "update-material",
    sourceLanguageId,
    targetLanguageId,
    specificationId: SPEC_IDS.material,
    dryRun,
    onProgress,
    allowUpdateIfTargetEqualsSource: true,
    allowUpdateIfTargetSubsetOfTransformed: true,
    transformValue: (value) => dictionary[value] || null,
  });
}

module.exports = {
  updateMaterial,
};

const { COLOR_TRANSLATIONS_EN, SPEC_IDS } = require("../config/specs");
const { runMultiValueSpecificationUpdate } = require("../lib/multiValueRunner");

async function updateColor({
  targetLanguageId = 2,
  sourceLanguageId = 1,
  dryRun = false,
  onProgress = null,
}) {
  return runMultiValueSpecificationUpdate({
    taskName: "update-color",
    sourceLanguageId,
    targetLanguageId,
    specificationId: SPEC_IDS.color,
    dryRun,
    onProgress,
    allowUpdateIfTargetEqualsSource: true,
    allowUpdateIfTargetSubsetOfTransformed: true,
    transformValue: (value) => COLOR_TRANSLATIONS_EN[value] || null,
  });
}

module.exports = {
  updateColor,
};

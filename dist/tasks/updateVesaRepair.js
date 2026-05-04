const { SPEC_IDS } = require("../config/specs");
const { runMultiValueSpecificationUpdate } = require("../lib/multiValueRunner");

async function updateVesaRepair({
  targetLanguageId = 2,
  sourceLanguageId = 1,
  dryRun = false,
  onProgress = null,
}) {
  return runMultiValueSpecificationUpdate({
    taskName: "update-vesa-repair",
    sourceLanguageId,
    targetLanguageId,
    specificationId: SPEC_IDS.vesa || 24,
    dryRun,
    onProgress,
    overwriteFilledTargets: true,
    transformValue: (value) => value,
  });
}

module.exports = {
  updateVesaRepair,
};

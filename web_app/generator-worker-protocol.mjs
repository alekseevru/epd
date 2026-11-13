export function isGeneratorStartupMessage(result) {
  return result?.ready === true && result.requestId == null;
}

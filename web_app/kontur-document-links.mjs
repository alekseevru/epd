const logisticsPaths = {
  LogisticsWaybill: "waybill",
  LogisticsForwardingOrder: "forwardingOrder",
};

export function konturDocumentUrl(boxId, messageId, entityId, typeNamedId, logisticsId = "", messageType = "Letter") {
  const box = String(boxId || "").replace(/@diadoc\.ru$/i, "");
  if (!box || !messageId || !entityId || messageType === "Draft") return null;
  const logisticsPath = logisticsPaths[typeNamedId];
  if (logisticsPath && logisticsId) {
    return `https://logist.kontur.ru/${encodeURIComponent(box)}/consignor/sign/${logisticsPath}/${encodeURIComponent(logisticsId)}`;
  }
  return `https://diadoc.kontur.ru/${encodeURIComponent(box)}/Document/Show?letterId=${encodeURIComponent(messageId)}&documentId=${encodeURIComponent(entityId)}`;
}

export function logisticsIdFromCustomData(customData) {
  return (customData || []).find(item => item.Key === "kl-id")?.Value || "";
}

// International truck registration numbers are not container units.
export const isInternationalTruckUnit = value =>
  /^[A-Z]{2}\d{4}\/[A-Z]\d{3}[A-Z]$/i.test(String(value || "").trim());

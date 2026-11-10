const clean = value => String(value ?? "").trim();

export function needsTmsRefresh(row, checkedAt = 0, now = Date.now()) {
  if (!row) return false;
  const unit = clean(row["Номера грузовых единиц"]);
  if (!unit) return false;
  const incomplete = !clean(row["Водитель"]) || !clean(row["Номер автомашины"]);
  const created = Date.parse(clean(row["Дата создания строки"]));
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 4);
  // If the creation date is absent, the regular four-month import cannot prove freshness.
  const outsideRegularWindow = !Number.isFinite(created) || created < cutoff.getTime();
  if (!incomplete && !outsideRegularWindow) return false;
  const ttl = incomplete ? 30 * 60_000 : 24 * 60 * 60_000;
  return !checkedAt || now - checkedAt >= ttl;
}

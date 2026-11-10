import fs from "node:fs";
import path from "node:path";

const moscowDate = value => new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);

export function mondayKey(value = new Date()) {
  const day = moscowDate(value);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = new Date(`${day}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (weekday + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

export function previousMondayKey(week) {
  const date = new Date(`${week}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

export function hasWeeklySnapshot(file, now = new Date()) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8"))[mondayKey(now)];
    return Boolean(snapshot && Array.isArray(snapshot.items) && Array.isArray(snapshot.tmsTrips));
  } catch { return false; }
}

export function recordWeeklyStatistics(file, value, now = new Date()) {
  const week = mondayKey(now);
  const previousWeek = previousMondayKey(week);
  let stored = {};
  if (fs.existsSync(file)) {
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* Replace corrupt snapshots with the current valid sample. */ }
  }
  const previous = stored[previousWeek] || null;
  let current = stored[week];
  if (!current || !Array.isArray(current.items) || !Array.isArray(current.tmsTrips)) {
    current = {capturedAt:now.toISOString(),items:value.items,tmsTrips:value.tmsTrips};
    fs.mkdirSync(path.dirname(file), {recursive:true});
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({...stored,[week]:current}));
    fs.renameSync(`${file}.tmp`, file);
  }
  return {currentWeek:week,previousWeek,current,previous};
}

// Utilities to safely handle dates across timezones.
// Backend stores either "YYYY-MM-DD" (date column) or full ISO timestamps.
// Financial display and storage use America/Sao_Paulo. Calendar arithmetic uses
// local civil dates, then explicitly serializes the intended day for Brazil.

import {FINANCIAL_TIME_ZONE,financialDay,financialDaysBetween} from '../../supabase/functions/_shared/financial_calendar';
export const BR_TZ = FINANCIAL_TIME_ZONE;

/**
 * Parse a date string to a Date anchored at noon LOCAL time of the intended day.
 * Handles "YYYY-MM-DD", "DD/MM/YYYY" and full ISO timestamps.
 * Returns null for invalid input.
 */
export function parseLocalDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  const s = String(input).trim();
  if (!s) return null;

  // DD/MM/YYYY ou DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    let year = parseInt(y);
    if (year < 100) year += 2000;
    const day = parseInt(d);
    const month = parseInt(m);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const dt = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (dt.getDate() !== day || dt.getMonth() !== month - 1) return null;
    return dt;
  }

  // YYYY-MM-DD (bare) — build at local noon to avoid UTC shift
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = +iso[1];
    const month = +iso[2];
    const day = +iso[3];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const dt = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
    return dt;
  }

  // ISO com hora mas sem timezone → tratar como local (não UTC)
  const isoNoTz = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (isoNoTz) {
    const dt = new Date(
      +isoNoTz[1], +isoNoTz[2] - 1, +isoNoTz[3],
      +isoNoTz[4], +isoNoTz[5], +(isoNoTz[6] ?? 0), 0
    );
    return isNaN(dt.getTime()) ? null : dt;
  }

  // ISO completo com timezone → confiar no parser nativo
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Format date in pt-BR (DD/MM/YYYY) in BR timezone. */
export function formatBR(input: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const day=typeof input==='string'&&/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/.test(input.trim())?financialDay(input):null;
  const d = day?new Date(day+'T15:00:00Z'):parseLocalDate(input);
  if (!d) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: BR_TZ, ...opts });
}

/** Format date+time in pt-BR (DD/MM/YYYY HH:mm) in BR timezone. */
export function formatBRDateTime(input: string | Date | null | undefined): string {
  const d = parseLocalDate(input);
  if (!d) return "";
  return d.toLocaleString("pt-BR", {
    timeZone: BR_TZ,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Add N months clamping day to last day of resulting month (avoids 31/01 → 03/03). */
export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  const y = d.getFullYear() + Math.floor(targetMonth / 12);
  const m = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const day = Math.min(d.getDate(), lastDay);
  return new Date(y, m, day, 12, 0, 0, 0);
}

/** Add N days (calendar). Always returns a new Date at local noon. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}

export type BusinessDayMode = "mon-fri" | "mon-sat" | "mon-sun";

/** Add N business days respecting the chosen week mode AND skipping Brazilian national holidays. */
export function addBusinessDays(date: Date, days: number, mode: BusinessDayMode = "mon-fri"): Date {
  const cur = new Date(date);
  let added = 0;
  while (added < days) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (mode === "mon-fri" && (dow === 0 || dow === 6)) continue;
    if (mode === "mon-sat" && dow === 0) continue;
    // Pula feriados nacionais BR em todos os modos (inclusive mon-sun)
    if (isBrazilianHoliday(cur)) continue;
    added++;
  }
  cur.setHours(12, 0, 0, 0);
  return cur;
}

/** Whole days between two dates (b - a), based on local midnight. */
export function daysBetween(a: string | Date, b: string | Date): number {
  const da = parseLocalDate(a);
  const db = parseLocalDate(b);
  if (!da || !db) return 0;
  const ms = new Date(db.getFullYear(), db.getMonth(), db.getDate()).getTime()
           - new Date(da.getFullYear(), da.getMonth(), da.getDate()).getTime();
  return Math.round(ms / 86400000);
}

/** True if `due` is strictly before today (BR local). */
export function isOverdue(due: string | Date | null | undefined, reference: Date = new Date()): boolean {
  return financialDaysBetween(due,reference)>0;
}

/** "YYYY-MM-DD" suitable for <input type="date"> bound to LOCAL date. */
export function toDateInputValue(input: string | Date | null | undefined): string {
  const d = parseLocalDate(input);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today in the Brazilian financial calendar. */
export function todayLocalISO(): string {
  return financialDay()!;
}

/** Store a selected civil day at a fixed daytime instant in Brazil. */
export function localNoonISO(dateStr: string | Date | null | undefined): string {
  if(typeof dateStr==='string'&&/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/.test(dateStr.trim())){
    const day=financialDay(dateStr);if(day)return day+'T15:00:00.000Z';
  }
  const d = parseLocalDate(dateStr);
  return (d ?? new Date()).toISOString();
}

/** True se a data cai em sábado ou domingo. */
export function isWeekend(input: string | Date | null | undefined): boolean {
  const d = parseLocalDate(input);
  if (!d) return false;
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

/** Páscoa (algoritmo de Meeus/Jones/Butcher) — usada p/ feriados móveis. */
function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function brHolidayKeys(year: number): Set<string> {
  const fixed = ["01-01","04-21","05-01","09-07","10-12","11-02","11-15","11-20","12-25"];
  const set = new Set(fixed);
  const easter = easterDate(year);
  for (const delta of [-48, -47, -2, 60]) {
    const d = new Date(easter);
    d.setDate(d.getDate() + delta);
    set.add(`${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return set;
}

const HOLIDAY_CACHE = new Map<number, Set<string>>();
/** True se a data é feriado nacional brasileiro (fixos + Carnaval, Sexta Santa, Corpus Christi). */
export function isBrazilianHoliday(input: string | Date | null | undefined): boolean {
  const d = parseLocalDate(input);
  if (!d) return false;
  const y = d.getFullYear();
  let s = HOLIDAY_CACHE.get(y);
  if (!s) { s = brHolidayKeys(y); HOLIDAY_CACHE.set(y, s); }
  return s.has(`${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
}

/** Próximo dia útil (não fds nem feriado nacional BR). */
export function nextBusinessDay(input: string | Date): Date {
  const base = parseLocalDate(input) ?? new Date();
  const out = new Date(base);
  out.setHours(12, 0, 0, 0);
  while (isWeekend(out) || isBrazilianHoliday(out)) {
    out.setDate(out.getDate() + 1);
  }
  return out;
}

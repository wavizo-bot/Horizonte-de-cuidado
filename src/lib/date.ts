import type { ISODate, MonthlyWeek, Recurrence, Weekday } from "../types";

const WEEKDAYS_PT = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISO(date: Date): ISODate {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseISO(value: ISODate): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

export function todayISO(): ISODate {
  return toISO(new Date());
}

export function nowISOString(): string {
  return new Date().toISOString();
}

export function addDays(value: ISODate, days: number): ISODate {
  const date = parseISO(value);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

export function addMonths(value: ISODate, months: number): ISODate {
  const date = parseISO(value);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return toISO(date);
}

export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxISO(a: ISODate | undefined, b: ISODate | undefined): ISODate | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function minISO(a: ISODate | undefined, b: ISODate | undefined): ISODate | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export function weekdayOf(value: ISODate): Weekday {
  return parseISO(value).getDay() as Weekday;
}

export function weekdayName(value: ISODate | Weekday, capitalize = false): string {
  const name = typeof value === "string" ? WEEKDAYS_PT[weekdayOf(value)] : WEEKDAYS_PT[value];
  return capitalize ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

export function weekdayShort(value: ISODate | Weekday): string {
  return typeof value === "string" ? WEEKDAYS_SHORT[weekdayOf(value)] : WEEKDAYS_SHORT[value];
}

export function monthName(monthIndex: number): string {
  return MONTHS_PT[monthIndex] ?? "";
}

export function formatLong(value: ISODate): string {
  const date = parseISO(value);
  return `${date.getDate()} de ${MONTHS_PT[date.getMonth()]} de ${date.getFullYear()}`;
}

export function formatMedium(value: ISODate): string {
  const date = parseISO(value);
  return `${date.getDate()} ${MONTHS_PT[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`;
}

export function formatShort(value: ISODate): string {
  const date = parseISO(value);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

export function formatShortYear(value: ISODate): string {
  const date = parseISO(value);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatMonthYear(value: ISODate): string {
  const date = parseISO(value);
  return `${MONTHS_PT[date.getMonth()]} de ${date.getFullYear()}`;
}

export function relativeDayLabel(target: ISODate, reference: ISODate = todayISO()): string {
  const d = diffDays(reference, target);
  if (d === 0) return "hoje";
  if (d === 1) return "amanhã";
  if (d === -1) return "ontem";
  if (d < 0) return `há ${Math.abs(d)} dias`;
  return `em ${d} dias`;
}

export function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function startOfMonth(value: ISODate): ISODate {
  const date = parseISO(value);
  return toISO(new Date(date.getFullYear(), date.getMonth(), 1, 12));
}

export function endOfMonth(value: ISODate): ISODate {
  const date = parseISO(value);
  return toISO(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
}

export function calendarCells(monthStart: ISODate): ISODate[] {
  const first = parseISO(monthStart);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay(), 12);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toISO(d);
  });
}

export function nthWeekdayOfMonth(year: number, month: number, weekday: Weekday, nth: MonthlyWeek): ISODate {
  if (nth === 5) {
    const last = new Date(year, month + 1, 0, 12);
    const delta = (last.getDay() - weekday + 7) % 7;
    return toISO(new Date(year, month, last.getDate() - delta, 12));
  }
  const first = new Date(year, month, 1, 12);
  const delta = (weekday - first.getDay() + 7) % 7;
  return toISO(new Date(year, month, 1 + delta + (nth - 1) * 7, 12));
}

export function recurrenceLabel(recurrence: Recurrence): string {
  switch (recurrence) {
    case "weekly":
      return "semanal";
    case "biweekly":
      return "quinzenal";
    case "monthly":
      return "mensal";
    default:
      return "sem recorrência";
  }
}

export function recurrenceDays(recurrence: Recurrence): number {
  switch (recurrence) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30;
    default:
      return 0;
  }
}

export function isWeekend(value: ISODate): boolean {
  const day = weekdayOf(value);
  return day === 0 || day === 6;
}

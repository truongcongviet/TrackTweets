import type { HeatmapRow, HourKey, HourlyHeatmapResponse } from "@/lib/types";

const HOUR_KEYS = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0")
) as HourKey[];

const DATE_PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timezone: string) {
  const cacheKey = `date:${timezone}`;
  const existing = DATE_PARTS_FORMATTERS.get(cacheKey);
  if (existing) return existing;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  DATE_PARTS_FORMATTERS.set(cacheKey, formatter);
  return formatter;
}

function getHourFormatter(timezone: string) {
  const cacheKey = `hour:${timezone}`;
  const existing = DATE_PARTS_FORMATTERS.get(cacheKey);
  if (existing) return existing;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  });

  DATE_PARTS_FORMATTERS.set(cacheKey, formatter);
  return formatter;
}

function formatDateKey(date: Date, timezone: string) {
  const parts = getDateFormatter(timezone).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format date in selected timezone");
  }

  return `${year}-${month}-${day}`;
}

function formatHourKey(date: Date, timezone: string) {
  return getHourFormatter(timezone).format(date) as HourKey;
}

function createEmptyHours(): Record<HourKey, number> {
  return HOUR_KEYS.reduce(
    (accumulator, hour) => {
      accumulator[hour] = 0;
      return accumulator;
    },
    {} as Record<HourKey, number>
  );
}

function getDateRangeInclusive(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid start or end date");
  }

  if (startDate.getTime() > endDate.getTime()) {
    throw new Error("Start date must be before or equal to end date");
  }

  const dates: string[] = [];
  const cursor = new Date(startDate);

  while (cursor.getTime() <= endDate.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function aggregatePostsByHour(input: {
  handle: string;
  start: string;
  end: string;
  timezone: string;
  timestamps: string[];
}): HourlyHeatmapResponse {
  const { handle, start, end, timezone, timestamps } = input;
  const range = getDateRangeInclusive(start, end);
  const rowMap = new Map<string, HeatmapRow>(
    range.map((date) => [
      date,
      {
        date,
        hours: createEmptyHours(),
        total: 0,
      },
    ])
  );

  let grandTotal = 0;
  let maxHourlyCount = 0;

  for (const timestamp of timestamps) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;

    const dayKey = formatDateKey(date, timezone);
    const row = rowMap.get(dayKey);
    if (!row) continue;

    const hourKey = formatHourKey(date, timezone);
    row.hours[hourKey] += 1;
    row.total += 1;
    grandTotal += 1;
    maxHourlyCount = Math.max(maxHourlyCount, row.hours[hourKey]);
  }

  return {
    handle,
    timezone,
    start,
    end,
    maxHourlyCount,
    grandTotal,
    rows: range
      .map((date) => rowMap.get(date)!)
      .sort((left, right) => right.date.localeCompare(left.date)),
  };
}

export { HOUR_KEYS };

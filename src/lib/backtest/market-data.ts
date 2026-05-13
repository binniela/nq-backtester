import type { Candle, ParsedCsvResult, Timeframe } from "./types";

const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "1d": 1440,
};

const HEADER_ALIASES: Record<string, string[]> = {
  time: [
    "time",
    "time_et",
    "timestamp",
    "timestamp_et",
    "datetime",
    "datetime_et",
    "date_time",
    "date/time",
    "barstart",
    "bar_time",
  ],
  date: ["date", "day"],
  open: ["open", "o"],
  high: ["high", "h"],
  low: ["low", "l"],
  close: ["close", "c", "last"],
  volume: ["volume", "vol", "v"],
};

export function timeframeToMinutes(timeframe: Timeframe) {
  return TIMEFRAME_MINUTES[timeframe];
}

export function estimateBaseTimeframeMinutes(candles: Candle[]) {
  if (candles.length < 3) {
    return 1;
  }

  const gaps = candles
    .slice(1, Math.min(candles.length, 500))
    .map((candle, index) => candle.time - candles[index].time)
    .filter((gap) => gap > 0 && gap <= 60 * 60)
    .sort((a, b) => a - b);

  if (!gaps.length) {
    return 1;
  }

  return Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)] / 60));
}

export function resampleCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  const minutes = timeframeToMinutes(timeframe);

  if (minutes === 1) {
    return candles;
  }

  const bucketSeconds = minutes * 60;
  const buckets = new Map<number, Candle>();

  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketTime);

    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

export function parseCsvCandles(rawText: string): ParsedCsvResult {
  const text = rawText.trim();

  if (!text) {
    return { candles: [], rejectedRows: 0 };
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { candles: [], rejectedRows: 0 };
  }

  const delimiter = detectDelimiter(lines[0]);
  const firstRow = splitRow(lines[0], delimiter);
  const hasHeader = firstRow.some((cell) => /[A-Za-z]/.test(cell));
  const header = hasHeader ? firstRow.map(normalizeHeader) : [];
  const rows = hasHeader ? lines.slice(1) : lines;
  const columnMap = hasHeader ? mapHeaders(header) : defaultColumnMap();
  const candlesByTime = new Map<number, Candle>();
  let rejectedRows = 0;

  for (const row of rows) {
    const cells = splitRow(row, delimiter);
    const parsed = parseCandleRow(cells, columnMap);

    if (!parsed) {
      rejectedRows += 1;
      continue;
    }

    candlesByTime.set(parsed.time, parsed);
  }

  return {
    candles: Array.from(candlesByTime.values()).sort((a, b) => a.time - b.time),
    rejectedRows,
  };
}

function parseCandleRow(
  cells: string[],
  columnMap: Record<"time" | "date" | "open" | "high" | "low" | "close" | "volume", number>,
): Candle | null {
  const timeCell = getCell(cells, columnMap.time);
  const dateCell = getCell(cells, columnMap.date);
  const timestamp = parseTimestamp(dateCell ? `${dateCell} ${timeCell}` : timeCell);
  const open = parseNumber(getCell(cells, columnMap.open));
  const high = parseNumber(getCell(cells, columnMap.high));
  const low = parseNumber(getCell(cells, columnMap.low));
  const close = parseNumber(getCell(cells, columnMap.close));
  const volume = parseNumber(getCell(cells, columnMap.volume), 0);

  if (
    timestamp === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    low > high
  ) {
    return null;
  }

  return {
    time: timestamp,
    open,
    high,
    low,
    close,
    volume,
  };
}

function parseTimestamp(value: string): number | null {
  const cleaned = value.trim().replace(/^"|"$/g, "");

  if (!cleaned) {
    return null;
  }

  const numeric = Number(cleaned);

  if (Number.isFinite(numeric)) {
    if (numeric > 1_000_000_000_000) {
      return Math.floor(numeric / 1000);
    }

    if (numeric > 1_000_000_000) {
      return Math.floor(numeric);
    }
  }

  const newYorkLocal = parseNewYorkWallTime(cleaned);

  if (newYorkLocal !== null) {
    return newYorkLocal;
  }

  const isoLike = cleaned.includes("T") ? cleaned : cleaned.replace(" ", "T");
  const parsed = Date.parse(isoLike);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
}

function parseNewYorkWallTime(value: string): number | null {
  const isoMatch = value.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  const usMatch = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  const match = isoMatch ?? usMatch;

  if (!match) {
    return null;
  }

  const [, first, second, third, rawHour = "0", rawMinute = "0", rawSecond = "0"] = match;
  const rawYear = isoMatch ? first : third;
  const rawMonth = isoMatch ? second : first;
  const rawDay = isoMatch ? third : second;
  const target = {
    year: Number(rawYear),
    month: Number(rawMonth),
    day: Number(rawDay),
    hour: Number(rawHour),
    minute: Number(rawMinute),
    second: Number(rawSecond),
  };
  const offsetCacheKey = `${target.year}-${target.month}-${target.day}-${target.hour}`;
  const cachedOffset = NEW_YORK_OFFSET_CACHE.get(offsetCacheKey);

  if (cachedOffset !== undefined) {
    return Math.floor(
      Date.UTC(
        target.year,
        target.month - 1,
        target.day,
        target.hour + cachedOffset,
        target.minute,
        target.second,
      ) / 1000,
    );
  }

  for (const offsetHours of [4, 5]) {
    const candidate = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour + offsetHours,
      target.minute,
      target.second,
    );

    if (newYorkParts(candidate).every(([key, value]) => target[key] === value)) {
      NEW_YORK_OFFSET_CACHE.set(offsetCacheKey, offsetHours);
      return Math.floor(candidate / 1000);
    }
  }

  return null;
}

const NEW_YORK_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const NEW_YORK_OFFSET_CACHE = new Map<string, number>();

function newYorkParts(timestampMs: number): Array<["year" | "month" | "day" | "hour" | "minute" | "second", number]> {
  const parts = NEW_YORK_TIMESTAMP_FORMATTER.formatToParts(new Date(timestampMs));
  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const rawHour = getPart("hour");

  return [
    ["year", getPart("year")],
    ["month", getPart("month")],
    ["day", getPart("day")],
    ["hour", rawHour === 24 ? 0 : rawHour],
    ["minute", getPart("minute")],
    ["second", getPart("second")],
  ];
}

function parseNumber(value: string, fallback?: number): number | null {
  const cleaned = value.replace(/[$,\s"]/g, "");

  if (!cleaned && fallback !== undefined) {
    return fallback;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectDelimiter(firstLine: string) {
  const candidates = [",", "\t", ";", "|"];
  return candidates.reduce((best, delimiter) => {
    const bestCount = firstLine.split(best).length;
    const candidateCount = firstLine.split(delimiter).length;
    return candidateCount > bestCount ? delimiter : best;
  }, ",");
}

function splitRow(row: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    const next = row[index + 1];

    if (character === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[\s-]+/g, "_");
}

function mapHeaders(headers: string[]) {
  const mapped = defaultColumnMap();

  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = headers.findIndex((header) => aliases.includes(header));

    if (index >= 0) {
      mapped[canonical as keyof typeof mapped] = index;
    }
  }

  if (mapped.time < 0 && mapped.date >= 0) {
    const timeIndex = headers.findIndex((header) => header === "time" || header === "bar_time");
    mapped.time = timeIndex;
  }

  return mapped;
}

function defaultColumnMap() {
  return {
    time: 0,
    date: -1,
    open: 1,
    high: 2,
    low: 3,
    close: 4,
    volume: 5,
  };
}

function getCell(cells: string[], index: number) {
  if (index < 0 || index >= cells.length) {
    return "";
  }

  return cells[index] ?? "";
}

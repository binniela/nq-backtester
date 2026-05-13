import type { Candle } from "./types";

export type SessionKey = "globex" | "london" | "ny-open" | "midday" | "close";

export type SessionInfo = {
  key: SessionKey;
  label: string;
  color: string;
};

const SESSION_COLORS: Record<SessionKey, string> = {
  globex: "#94a3b8",
  london: "#38bdf8",
  "ny-open": "#f59e0b",
  midday: "#a78bfa",
  close: "#22c55e",
};

const SESSION_LABELS: Record<SessionKey, string> = {
  globex: "Globex",
  london: "London / premarket",
  "ny-open": "NY open",
  midday: "Midday chop",
  close: "Close",
};

const NEW_YORK_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function sessionForTimestamp(timestamp: number): SessionInfo {
  const { hour, minute } = getNewYorkClock(timestamp);
  const minutes = hour * 60 + minute;
  let key: SessionKey = "globex";

  if (minutes >= 2 * 60 && minutes < 9 * 60 + 30) {
    key = "london";
  } else if (minutes >= 9 * 60 + 30 && minutes < 11 * 60) {
    key = "ny-open";
  } else if (minutes >= 11 * 60 && minutes < 14 * 60) {
    key = "midday";
  } else if (minutes >= 14 * 60 && minutes <= 16 * 60 + 15) {
    key = "close";
  }

  return {
    key,
    label: SESSION_LABELS[key],
    color: SESSION_COLORS[key],
  };
}

export function getSimpleSession(timestamp: number): "asia" | "london" | "us" {
  const { hour, minute } = getNewYorkClock(timestamp);
  const minutes = hour * 60 + minute;
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "us";
  if (minutes >= 2 * 60 && minutes < 9 * 60 + 30) return "london";
  return "asia";
}

export function getSessionStartMarkers(candles: Candle[]) {
  const markers: Array<{
    time: number;
    label: string;
    color: string;
  }> = [];

  let lastDay = "";
  let lastSession: SessionKey | "" = "";

  for (const candle of candles) {
    const clock = getNewYorkClock(candle.time);
    const dayKey = `${clock.weekday}-${new Date(candle.time * 1000).toISOString().slice(0, 10)}`;
    const session = sessionForTimestamp(candle.time);
    const isSessionChange = dayKey !== lastDay || session.key !== lastSession;

    if (isSessionChange && session.key !== "globex") {
      markers.push({
        time: candle.time,
        label: session.label === "London / premarket" ? "LON" : session.label === "NY open" ? "NY" : session.label === "Midday chop" ? "MID" : "CL",
        color: session.color,
      });
    }

    lastDay = dayKey;
    lastSession = session.key;
  }

  return markers;
}

function getNewYorkClock(timestamp: number) {
  const parts = NEW_YORK_PARTS_FORMATTER.formatToParts(new Date(timestamp * 1000));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const hour = Number(value("hour"));

  return {
    weekday: value("weekday"),
    hour: hour === 24 ? 0 : hour,
    minute: Number(value("minute")),
  };
}

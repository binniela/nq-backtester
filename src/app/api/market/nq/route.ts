import { NextResponse } from "next/server";
import type { Candle } from "@/lib/backtest/types";

export const dynamic = "force-dynamic";

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "1d"]);
const ALLOWED_RANGES = new Set(["5d", "7d", "30d", "60d", "6mo", "1y", "2y", "3y"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const interval = searchParams.get("interval") ?? "5m";
  const range = searchParams.get("range") ?? "60d";

  if (!ALLOWED_INTERVALS.has(interval) || !ALLOWED_RANGES.has(range)) {
    return NextResponse.json(
      {
        error: "Unsupported interval or range.",
      },
      { status: 400 },
    );
  }

  const upstreamUrl = new URL("https://query1.finance.yahoo.com/v8/finance/chart/NQ=F");
  upstreamUrl.searchParams.set("interval", interval);
  upstreamUrl.searchParams.set("range", range);
  upstreamUrl.searchParams.set("includePrePost", "true");

  const upstream = await fetch(upstreamUrl, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: "Free NQ preview source is temporarily unavailable. Import a CSV for full-depth backtesting.",
        status: upstream.status,
      },
      { status: 502 },
    );
  }

  const payload = await upstream.json();
  const result = payload?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];

    if (![open, high, low, close].every(Number.isFinite)) {
      continue;
    }

    candles.push({
      time: timestamps[index],
      open,
      high,
      low,
      close,
      volume: Number.isFinite(quote.volume?.[index]) ? quote.volume[index] : 0,
    });
  }

  return NextResponse.json({
    symbol: "NQ=F",
    source: "Yahoo Finance chart endpoint",
    interval,
    range,
    candles,
    note:
      "This free preview source may limit intraday depth. Import licensed/user-owned CME futures CSV data for multi-year 1m/5m testing.",
  });
}

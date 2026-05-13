import { describe, expect, it } from "vitest";
import { parseCsvCandles, resampleCandles } from "../market-data";
import { closeTrade, createTrade, maybeExitTradeOnCandle } from "../trades";

describe("market data helpers", () => {
  it("parses OHLCV CSV with separate date and time columns", () => {
    const result = parseCsvCandles(`Date,Time,Open,High,Low,Close,Volume
2026-01-06,09:30:00,18400,18412.25,18396,18408.5,1200
2026-01-06,09:31:00,18408.5,18418,18402,18415.25,1500`);

    expect(result.rejectedRows).toBe(0);
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0]).toMatchObject({
      open: 18400,
      high: 18412.25,
      low: 18396,
      close: 18408.5,
      volume: 1200,
    });
  });

  it("parses Kaggle-style timestamp ET columns", () => {
    const result = parseCsvCandles(`timestamp ET,open,high,low,close,volume,Vwap_RTH
12/11/2025 09:30,25000,25020,24980,25010,1000,25005`);

    expect(result.rejectedRows).toBe(0);
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]).toMatchObject({
      open: 25000,
      high: 25020,
      low: 24980,
      close: 25010,
      volume: 1000,
    });
  });

  it("resamples one minute bars into five minute candles", () => {
    const result = parseCsvCandles(`timestamp,open,high,low,close,volume
1767709800,10,12,9,11,100
1767709860,11,15,10,14,120
1767709920,14,16,13,15,130
1767709980,15,17,12,13,140
1767710040,13,18,12,16,150`);

    const resampled = resampleCandles(result.candles, "5m");

    expect(resampled).toHaveLength(1);
    expect(resampled[0]).toMatchObject({
      open: 10,
      high: 18,
      low: 9,
      close: 16,
      volume: 640,
    });
  });

  it("resamples one minute bars into hourly candles", () => {
    const result = parseCsvCandles(`timestamp,open,high,low,close,volume
1767709800,10,12,9,11,100
1767709860,11,15,10,14,120
1767713400,14,18,13,17,150`);

    const resampled = resampleCandles(result.candles, "1h");

    expect(resampled).toHaveLength(2);
    expect(resampled[0]).toMatchObject({
      open: 10,
      high: 15,
      low: 9,
      close: 14,
      volume: 220,
    });
  });
});

describe("trade simulation", () => {
  it("fills a long target when the next candle reaches target price", () => {
    const entry = { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 };
    const trade = createTrade({
      side: "long",
      candle: entry,
      index: 0,
      contracts: 1,
      stopPoints: 4,
      targetPoints: 8,
    });

    const exit = maybeExitTradeOnCandle(trade, { time: 2, open: 101, high: 108, low: 100, close: 107, volume: 10 }, 1);

    expect(exit?.exitReason).toBe("target");
    expect(exit?.pnl).toBe(160);
  });

  it("calculates short manual exits", () => {
    const entry = { time: 1, open: 100, high: 101, low: 99, close: 100, volume: 10 };
    const trade = createTrade({
      side: "short",
      candle: entry,
      index: 0,
      contracts: 2,
      stopPoints: 4,
      targetPoints: 8,
    });

    const closed = closeTrade(trade, { time: 2, open: 95, high: 98, low: 92, close: 95, volume: 10 }, 1, 95, "manual");

    expect(closed.pnl).toBe(200);
  });
});

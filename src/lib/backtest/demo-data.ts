import type { Candle } from "./types";

export function generateDemoCandles(): Candle[] {
  const candles: Candle[] = [];
  const start = Math.floor(Date.UTC(2026, 0, 6, 14, 30, 0) / 1000);
  let previousClose = 18_450;

  for (let index = 0; index < 390; index += 1) {
    const time = start + index * 60;
    const drift = Math.sin(index / 18) * 7 + Math.cos(index / 41) * 12;
    const impulse = index % 67 === 0 ? 38 : 0;
    const open = previousClose;
    const close = open + drift * 0.16 + impulse * 0.1 - 1.2;
    const high = Math.max(open, close) + 5 + (index % 9);
    const low = Math.min(open, close) - 5 - (index % 7);
    const volume = 900 + Math.round(Math.abs(drift) * 80) + (index % 35) * 18;

    candles.push({
      time,
      open: roundToTick(open),
      high: roundToTick(high),
      low: roundToTick(low),
      close: roundToTick(close),
      volume,
    });
    previousClose = close;
  }

  return candles;
}

function roundToTick(value: number) {
  return Math.round(value * 4) / 4;
}

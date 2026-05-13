import type { Candle, IndicatorPoint } from "./types";

const NEW_YORK_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function ema(candles: Candle[], period: number): IndicatorPoint[] {
  if (period <= 1 || !candles.length) {
    return candles.map((candle) => ({ time: candle.time, value: candle.close }));
  }

  const multiplier = 2 / (period + 1);
  const output: IndicatorPoint[] = [];
  let previous = candles[0].close;

  for (let index = 0; index < candles.length; index += 1) {
    const close = candles[index].close;
    previous = index === 0 ? close : close * multiplier + previous * (1 - multiplier);
    output.push({ time: candles[index].time, value: roundPrice(previous) });
  }

  return output;
}

export function rsi(candles: Candle[], period = 14): IndicatorPoint[] {
  if (candles.length <= period) {
    return [];
  }

  const output: IndicatorPoint[] = [];
  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }

  averageGain /= period;
  averageLoss /= period;
  output.push({ time: candles[period].time, value: calculateRsi(averageGain, averageLoss) });

  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output.push({ time: candles[index].time, value: calculateRsi(averageGain, averageLoss) });
  }

  return output;
}

export function vwap(candles: Candle[]): IndicatorPoint[] {
  const output: IndicatorPoint[] = [];
  let activeSession = "";
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const sessionKey = NEW_YORK_DATE_FORMATTER.format(new Date(candle.time * 1000));

    if (sessionKey !== activeSession) {
      activeSession = sessionKey;
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
    }

    const volume = Math.max(candle.volume, 1);
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePriceVolume += typicalPrice * volume;
    cumulativeVolume += volume;
    output.push({
      time: candle.time,
      value: roundPrice(cumulativePriceVolume / cumulativeVolume),
    });
  }

  return output;
}

function calculateRsi(averageGain: number, averageLoss: number) {
  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return Math.max(0, Math.min(100, 100 - 100 / (1 + relativeStrength)));
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}

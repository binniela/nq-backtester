import { NQ_POINT_VALUE, type Candle, type ExitReason, type Trade, type TradeSide } from "./types";

export function createTrade({
  side,
  candle,
  index,
  contracts,
  stopPoints,
  targetPoints,
  notes,
}: {
  side: TradeSide;
  candle: Candle;
  index: number;
  contracts: number;
  stopPoints: number;
  targetPoints: number;
  notes?: string;
}): Trade {
  const direction = side === "long" ? 1 : -1;
  const entryPrice = candle.close;

  return {
    id: `${side}-${candle.time}-${Math.random().toString(16).slice(2)}`,
    side,
    contracts,
    entryIndex: index,
    entryTime: candle.time,
    entryPrice,
    stopPrice: entryPrice - stopPoints * direction,
    targetPrice: entryPrice + targetPoints * direction,
    notes,
  };
}

export function maybeExitTradeOnCandle(trade: Trade, candle: Candle, index: number): Trade | null {
  if (trade.exitTime) {
    return null;
  }

  if (trade.side === "long") {
    if (candle.low <= trade.stopPrice) {
      return closeTrade(trade, candle, index, trade.stopPrice, "stop");
    }

    if (candle.high >= trade.targetPrice) {
      return closeTrade(trade, candle, index, trade.targetPrice, "target");
    }
  } else {
    if (candle.high >= trade.stopPrice) {
      return closeTrade(trade, candle, index, trade.stopPrice, "stop");
    }

    if (candle.low <= trade.targetPrice) {
      return closeTrade(trade, candle, index, trade.targetPrice, "target");
    }
  }

  return null;
}

export function closeTrade(
  trade: Trade,
  candle: Candle,
  index: number,
  exitPrice: number,
  reason: ExitReason,
): Trade {
  const points = trade.side === "long" ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;

  return {
    ...trade,
    exitIndex: index,
    exitTime: candle.time,
    exitPrice,
    exitReason: reason,
    pnl: points * NQ_POINT_VALUE * trade.contracts,
  };
}

export function getTradeStats(trades: Trade[]) {
  const closedTrades = trades.filter((trade) => trade.exitTime);
  const wins = closedTrades.filter((trade) => (trade.pnl ?? 0) > 0).length;
  const losses = closedTrades.filter((trade) => (trade.pnl ?? 0) <= 0).length;
  const totalPnl = closedTrades.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);

  return {
    closedTrades,
    wins,
    losses,
    totalPnl,
    winRate: closedTrades.length ? wins / closedTrades.length : 0,
  };
}

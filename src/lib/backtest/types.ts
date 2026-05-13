export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type IndicatorPoint = {
  time: number;
  value: number;
};

export type TradeSide = "long" | "short";
export type ExitReason = "manual" | "stop" | "target";

export type Trade = {
  id: string;
  side: TradeSide;
  contracts: number;
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitIndex?: number;
  exitTime?: number;
  exitPrice?: number;
  exitReason?: ExitReason;
  pnl?: number;
  notes?: string;
};

export type DrawingTool =
  | "cursor"
  | "trend"
  | "horizontal"
  | "vertical"
  | "cross"
  | "rectangle"
  | "fib"
  | "brush"
  | "text"
  | "measure"
  | "long-position"
  | "short-position";

export type DrawingAnchor = {
  time: number;
  price: number;
};

export type ChartDrawing = {
  id: string;
  type: Exclude<DrawingTool, "cursor">;
  points: DrawingAnchor[];
  color: string;
  text?: string;
};

export type ParsedCsvResult = {
  candles: Candle[];
  rejectedRows: number;
};

export const NQ_POINT_VALUE = 20;
export const NQ_TICK_SIZE = 0.25;
export const NQ_TICK_VALUE = 5;

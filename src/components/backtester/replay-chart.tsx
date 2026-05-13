"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, ChartDrawing, DrawingAnchor, DrawingTool, IndicatorPoint, Trade } from "@/lib/backtest/types";

type ReplayChartProps = {
  candles: Candle[];
  ema9: IndicatorPoint[];
  ema20: IndicatorPoint[];
  ema50: IndicatorPoint[];
  vwap: IndicatorPoint[];
  trades: Trade[];
  sessionMarkers: Array<{ time: number; label: string; color: string }>;
  showEma9: boolean;
  showEma20: boolean;
  showEma50: boolean;
  showVwap: boolean;
  showVolume: boolean;
  openTrade?: Trade;
  activeDrawingTool: DrawingTool;
  drawings: ChartDrawing[];
  pendingDrawing: ChartDrawing | null;
  onDrawingsChange: (drawings: ChartDrawing[]) => void;
  onPendingDrawingChange: (drawing: ChartDrawing | null) => void;
};

type ScreenPoint = {
  x: number;
  y: number;
};

type RenderedDrawing = {
  drawing: ChartDrawing;
  points: ScreenPoint[];
};

export function ReplayChart({
  candles,
  ema9,
  ema20,
  ema50,
  vwap,
  trades,
  sessionMarkers,
  showEma9,
  showEma20,
  showEma50,
  showVwap,
  showVolume,
  openTrade,
  activeDrawingTool,
  drawings,
  pendingDrawing,
  onDrawingsChange,
  onPendingDrawingChange,
}: ReplayChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema9SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLineRefs = useRef<IPriceLine[]>([]);
  const activeDrawingToolRef = useRef(activeDrawingTool);
  const candlesRef = useRef(candles);
  const drawingsRef = useRef(drawings);
  const pendingDrawingRef = useRef(pendingDrawing);
  const onDrawingsChangeRef = useRef(onDrawingsChange);
  const onPendingDrawingChangeRef = useRef(onPendingDrawingChange);
  const brushDraftRef = useRef<ChartDrawing | null>(null);
  const [renderedDrawings, setRenderedDrawings] = useState<RenderedDrawing[]>([]);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });

  const chartData = useMemo(
    () =>
      candles.map<CandlestickData<UTCTimestamp>>((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    [candles],
  );

  const volumeData = useMemo(
    () =>
      candles.map<HistogramData<UTCTimestamp>>((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color: candle.close >= candle.open ? "rgba(34, 197, 94, 0.28)" : "rgba(248, 113, 113, 0.28)",
      })),
    [candles],
  );

  const markers = useMemo(() => {
    const chartMarkers: SeriesMarker<Time>[] = sessionMarkers.map((marker) => ({
      id: `session-${marker.time}-${marker.label}`,
      time: marker.time as UTCTimestamp,
      position: "aboveBar",
      shape: "circle",
      color: marker.color,
      text: marker.label,
      size: 0.65,
    }));

    for (const trade of trades) {
      chartMarkers.push({
        id: `${trade.id}-entry`,
        time: trade.entryTime as UTCTimestamp,
        position: trade.side === "long" ? "belowBar" : "aboveBar",
        shape: trade.side === "long" ? "arrowUp" : "arrowDown",
        color: trade.side === "long" ? "#22c55e" : "#f97316",
        text: `${trade.side === "long" ? "BUY" : "SELL"} ${trade.entryPrice.toFixed(2)}`,
      });

      if (trade.exitTime && trade.exitPrice !== undefined) {
        const pnl = trade.pnl ?? 0;
        chartMarkers.push({
          id: `${trade.id}-exit`,
          time: trade.exitTime as UTCTimestamp,
          position: trade.side === "long" ? "aboveBar" : "belowBar",
          shape: trade.exitReason === "manual" ? "circle" : "square",
          color: pnl >= 0 ? "#14b8a6" : "#ef4444",
          text: `${trade.exitReason?.toUpperCase()} ${formatDollars(pnl)}`,
        });
      }
    }

    return chartMarkers.sort((a, b) => Number(a.time) - Number(b.time));
  }, [sessionMarkers, trades]);

  useEffect(() => {
    activeDrawingToolRef.current = activeDrawingTool;
    candlesRef.current = candles;
    drawingsRef.current = drawings;
    pendingDrawingRef.current = pendingDrawing;
    onDrawingsChangeRef.current = onDrawingsChange;
    onPendingDrawingChangeRef.current = onPendingDrawingChange;
  }, [activeDrawingTool, candles, drawings, onDrawingsChange, onPendingDrawingChange, pendingDrawing]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#000000" },
        textColor: "#aeb4bc",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "rgba(120, 124, 132, 0.14)" },
        horzLines: { color: "rgba(120, 124, 132, 0.14)" },
      },
      rightPriceScale: {
        borderColor: "rgba(120, 124, 132, 0.28)",
        scaleMargins: { top: 0.08, bottom: 0.2 },
      },
      timeScale: {
        borderColor: "rgba(120, 124, 132, 0.28)",
        rightOffset: 8,
        barSpacing: 7,
        secondsVisible: false,
        timeVisible: true,
      },
      crosshair: {
        vertLine: { color: "rgba(160, 170, 190, 0.35)", labelBackgroundColor: "#111316" },
        horzLine: { color: "rgba(160, 170, 190, 0.35)", labelBackgroundColor: "#111316" },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#86efac",
      wickDownColor: "#fca5a5",
      priceFormat: { type: "price", precision: 2, minMove: 0.25 },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const makeLine = (color: string, width: 1 | 2 = 1) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ema9SeriesRef.current = makeLine("#facc15", 1);
    ema20SeriesRef.current = makeLine("#38bdf8", 1);
    ema50SeriesRef.current = makeLine("#a78bfa", 1);
    vwapSeriesRef.current = makeLine("#f97316", 2);
    markerApiRef.current = createSeriesMarkers(candleSeries, []);

    const updateOverlay = () => {
      const nextSize = getContainerSize(containerRef.current);
      setOverlaySize(nextSize);
      setRenderedDrawings(
        [...drawingsRef.current, ...(pendingDrawingRef.current ? [pendingDrawingRef.current] : [])]
          .map((drawing) => projectDrawing(drawing, chart, candleSeries, candlesRef.current))
          .filter((drawing): drawing is RenderedDrawing => drawing !== null),
      );
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(updateOverlay);
    window.addEventListener("resize", updateOverlay);
    updateOverlay();

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateOverlay);
      window.removeEventListener("resize", updateOverlay);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markerApiRef.current = null;
      volumeSeriesRef.current = null;
      ema9SeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
      vwapSeriesRef.current = null;
      priceLineRefs.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;

    if (!chart || !candleSeries) {
      return;
    }

    const nextSize = getContainerSize(containerRef.current);
    setOverlaySize(nextSize);
    setRenderedDrawings(
      [...drawings, ...(pendingDrawing ? [pendingDrawing] : [])]
        .map((drawing) => projectDrawing(drawing, chart, candleSeries, candles))
        .filter((drawing): drawing is RenderedDrawing => drawing !== null),
    );
  }, [candles, chartData, drawings, pendingDrawing]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartRef.current;

    if (!candleSeries || !chart) {
      return;
    }

    candleSeries.setData(chartData);
    volumeSeriesRef.current?.setData(showVolume ? volumeData : []);
    ema9SeriesRef.current?.setData(showEma9 ? toLineData(ema9) : []);
    ema20SeriesRef.current?.setData(showEma20 ? toLineData(ema20) : []);
    ema50SeriesRef.current?.setData(showEma50 ? toLineData(ema50) : []);
    vwapSeriesRef.current?.setData(showVwap ? toLineData(vwap) : []);
    markerApiRef.current?.setMarkers(markers);

    for (const priceLine of priceLineRefs.current) {
      candleSeries.removePriceLine(priceLine);
    }

    priceLineRefs.current = [];

    if (openTrade) {
      priceLineRefs.current.push(
        candleSeries.createPriceLine({
          price: openTrade.stopPrice,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "SL",
        }),
      );
      priceLineRefs.current.push(
        candleSeries.createPriceLine({
          price: openTrade.targetPrice,
          color: "#14b8a6",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "TP",
        }),
      );
    }

    if (chartData.length > 0) {
      chart.timeScale().scrollToPosition(8, false);
    }
  }, [
    chartData,
    ema9,
    ema20,
    ema50,
    markers,
    openTrade,
    showEma9,
    showEma20,
    showEma50,
    showVolume,
    showVwap,
    volumeData,
    vwap,
  ]);

  function setPendingDrawingLocal(drawing: ChartDrawing | null) {
    pendingDrawingRef.current = drawing;
    onPendingDrawingChangeRef.current(drawing);
  }

  function appendDrawing(drawing: ChartDrawing) {
    const nextDrawings = [...drawingsRef.current, drawing];
    drawingsRef.current = nextDrawings;
    onDrawingsChangeRef.current(nextDrawings);
  }

  function anchorFromClientPoint(clientX: number, clientY: number): DrawingAnchor | null {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const container = containerRef.current;

    if (!chart || !candleSeries || !container) {
      return null;
    }

    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const time = timeFromCoordinate(chart, candlesRef.current, x);
    const price = candleSeries.coordinateToPrice(y);

    if (time === null || price === null) {
      return null;
    }

    return {
      time,
      price: Number(price),
    };
  }

  function handleDrawingClick(event: ReactMouseEvent<HTMLDivElement>) {
    const tool = activeDrawingToolRef.current;

    if (tool === "cursor" || tool === "brush") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const anchor = anchorFromClientPoint(event.clientX, event.clientY);

    if (!anchor) {
      return;
    }

    if (tool === "horizontal") {
      appendDrawing({
        id: createDrawingId("horizontal"),
        type: "horizontal",
        points: [anchor],
        color: colorForDrawing("horizontal"),
      });
      setPendingDrawingLocal(null);
      return;
    }

    if (tool === "text") {
      appendDrawing({
        id: createDrawingId("text"),
        type: "text",
        points: [anchor],
        color: colorForDrawing("text"),
        text: "Note",
      });
      setPendingDrawingLocal(null);
      return;
    }

    const pending = pendingDrawingRef.current;

    if (pending && pending.type === tool && pending.points.length === 1) {
      appendDrawing({
        ...pending,
        points: [pending.points[0], anchor],
      });
      setPendingDrawingLocal(null);
      return;
    }

    setPendingDrawingLocal({
      id: createDrawingId(tool),
      type: tool,
      points: [anchor],
      color: colorForDrawing(tool),
    });
  }

  function handleDrawingPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeDrawingToolRef.current !== "brush") {
      return;
    }

    const anchor = anchorFromClientPoint(event.clientX, event.clientY);

    if (!anchor) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const draft: ChartDrawing = {
      id: createDrawingId("brush"),
      type: "brush",
      points: [anchor],
      color: colorForDrawing("brush"),
    };

    brushDraftRef.current = draft;
    setPendingDrawingLocal(draft);
  }

  function handleDrawingPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeDrawingToolRef.current !== "brush" || !brushDraftRef.current) {
      return;
    }

    const anchor = anchorFromClientPoint(event.clientX, event.clientY);

    if (!anchor) {
      return;
    }

    const draft = brushDraftRef.current;
    const previous = draft.points[draft.points.length - 1];

    if (previous && !shouldAddBrushPoint(previous, anchor)) {
      return;
    }

    const nextDraft = {
      ...draft,
      points: [...draft.points, anchor],
    };

    brushDraftRef.current = nextDraft;
    setPendingDrawingLocal(nextDraft);
  }

  function handleDrawingPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeDrawingToolRef.current !== "brush" || !brushDraftRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const draft = brushDraftRef.current;
    brushDraftRef.current = null;

    if (draft.points.length > 1) {
      appendDrawing(draft);
    }

    setPendingDrawingLocal(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className={`relative h-full min-h-[460px] w-full overflow-hidden ${
        activeDrawingTool === "cursor" ? "" : "cursor-crosshair"
      }`}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <svg className="pointer-events-none absolute inset-0 z-10" width={overlaySize.width} height={overlaySize.height}>
        {renderedDrawings.map(({ drawing, points }) => (
          <DrawingSvg key={drawing.id} drawing={drawing} points={points} width={overlaySize.width} />
        ))}
      </svg>
      {activeDrawingTool !== "cursor" ? (
        <div
          aria-label={`${activeDrawingTool} drawing layer`}
          className="absolute inset-0 z-20"
          data-testid="drawing-hit-layer"
          onClick={handleDrawingClick}
          onPointerDown={handleDrawingPointerDown}
          onPointerMove={handleDrawingPointerMove}
          onPointerUp={handleDrawingPointerUp}
        />
      ) : null}
    </div>
  );
}

function toLineData(points: IndicatorPoint[]): LineData<Time>[] {
  return points.map((point) => ({
    time: point.time as UTCTimestamp,
    value: point.value,
  }));
}

function formatDollars(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(0)}`;
}

function DrawingSvg({
  drawing,
  points,
  width,
}: {
  drawing: ChartDrawing;
  points: ScreenPoint[];
  width: number;
}) {
  if (drawing.type === "horizontal" && points[0]) {
    return (
      <g>
        <line x1={0} x2={width} y1={points[0].y} y2={points[0].y} stroke={drawing.color} strokeWidth={1.5} strokeDasharray="6 4" />
        <AnchorPoint point={points[0]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "trend" && points.length >= 2) {
    return (
      <g>
        <line x1={points[0].x} x2={points[1].x} y1={points[0].y} y2={points[1].y} stroke={drawing.color} strokeWidth={2} />
        <AnchorPoint point={points[0]} color={drawing.color} />
        <AnchorPoint point={points[1]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "brush") {
    if (points.length >= 2) {
      return (
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={drawing.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          opacity={0.95}
        />
      );
    }

    if (points[0]) {
      return <AnchorPoint point={points[0]} color={drawing.color} />;
    }
  }

  if (drawing.type === "fib" && points.length >= 2) {
    const x1 = Math.min(points[0].x, points[1].x);
    const x2 = Math.max(width - 56, x1 + 80);
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

    return (
      <g>
        {levels.map((level) => {
          const y = points[0].y + (points[1].y - points[0].y) * level;

          return (
            <g key={level}>
              <line x1={x1} x2={x2} y1={y} y2={y} stroke={drawing.color} strokeWidth={1.2} opacity={level === 0 || level === 1 ? 0.95 : 0.55} />
              <text x={x2 + 6} y={y + 4} fill={drawing.color} fontSize={11} opacity={0.9}>
                {(level * 100).toFixed(level === 0 || level === 1 || level === 0.5 ? 0 : 1)}%
              </text>
            </g>
          );
        })}
        <line x1={points[0].x} x2={points[1].x} y1={points[0].y} y2={points[1].y} stroke={drawing.color} strokeWidth={1.5} opacity={0.8} />
        <AnchorPoint point={points[0]} color={drawing.color} />
        <AnchorPoint point={points[1]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "measure" && points.length >= 2) {
    const left = Math.min(points[0].x, points[1].x);
    const top = Math.min(points[0].y, points[1].y);
    const boxWidth = Math.abs(points[1].x - points[0].x);
    const boxHeight = Math.abs(points[1].y - points[0].y);
    const priceDiff = drawing.points[1].price - drawing.points[0].price;
    const percentDiff = drawing.points[0].price ? (priceDiff / drawing.points[0].price) * 100 : 0;
    const label = `${formatSignedNumber(priceDiff)} pts ${formatSignedNumber(percentDiff)}%`;
    const labelWidth = Math.max(112, label.length * 7 + 16);
    const labelX = Math.min(Math.max(left, 6), Math.max(6, width - labelWidth - 8));
    const labelY = Math.max(18, top - 8);

    return (
      <g>
        <rect x={left} y={top} width={boxWidth} height={boxHeight} fill="rgba(34, 211, 238, 0.08)" stroke={drawing.color} strokeDasharray="5 4" />
        <line x1={points[0].x} x2={points[1].x} y1={points[0].y} y2={points[1].y} stroke={drawing.color} strokeWidth={1.5} />
        <rect x={labelX} y={labelY - 16} width={labelWidth} height={22} rx={4} fill="rgba(0, 0, 0, 0.84)" stroke="rgba(34, 211, 238, 0.42)" />
        <text x={labelX + 8} y={labelY - 1} fill={drawing.color} fontSize={11} fontWeight={600}>
          {label}
        </text>
        <AnchorPoint point={points[0]} color={drawing.color} />
        <AnchorPoint point={points[1]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "text" && points[0]) {
    const label = drawing.text ?? "Note";
    const labelWidth = Math.max(42, label.length * 7 + 18);
    const x = Math.min(points[0].x + 8, Math.max(8, width - labelWidth - 8));
    const y = Math.max(24, points[0].y - 8);

    return (
      <g>
        <rect x={x - 6} y={y - 17} width={labelWidth} height={24} rx={4} fill="rgba(0, 0, 0, 0.82)" stroke="rgba(229, 231, 235, 0.32)" />
        <text x={x + 3} y={y} fill={drawing.color} fontSize={12} fontWeight={600}>
          {label}
        </text>
        <AnchorPoint point={points[0]} color={drawing.color} />
      </g>
    );
  }

  if (points[0]) {
    return <AnchorPoint point={points[0]} color={drawing.color} />;
  }

  return null;
}

function AnchorPoint({ point, color }: { point: ScreenPoint; color: string }) {
  return <circle cx={point.x} cy={point.y} r={4} fill="#000" stroke={color} strokeWidth={2} />;
}

function projectDrawing(
  drawing: ChartDrawing,
  chart: IChartApi,
  candleSeries: ISeriesApi<"Candlestick">,
  candles: Candle[],
): RenderedDrawing | null {
  const points = drawing.points
    .map((point) => {
      const anchorTime = findNearestVisibleTime(candles, point.time);
      const x = anchorTime === null ? null : chart.timeScale().timeToCoordinate(anchorTime as UTCTimestamp);
      const y = candleSeries.priceToCoordinate(point.price);

      if (x === null || y === null) {
        return null;
      }

      return {
        x: Number(x),
        y: Number(y),
      };
    })
    .filter((point): point is ScreenPoint => point !== null);

  if (!points.length) {
    return null;
  }

  return { drawing, points };
}

function findNearestVisibleTime(candles: Candle[], targetTime: number) {
  if (!candles.length) {
    return null;
  }

  let low = 0;
  let high = candles.length - 1;
  let result = candles[0].time;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (candles[mid].time <= targetTime) {
      result = candles[mid].time;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function getContainerSize(container: HTMLDivElement | null) {
  if (!container) {
    return { width: 0, height: 0 };
  }

  return {
    width: container.clientWidth,
    height: container.clientHeight,
  };
}

function timeFromCoordinate(chart: IChartApi, candles: Candle[], x: number) {
  const directTime = timeToTimestamp(chart.timeScale().coordinateToTime(x));

  if (directTime !== null) {
    return directTime;
  }

  if (!candles.length) {
    return null;
  }

  const logical = chart.timeScale().coordinateToLogical(x);

  if (logical === null || !Number.isFinite(Number(logical))) {
    return candles[candles.length - 1].time;
  }

  const index = Math.max(0, Math.min(candles.length - 1, Math.round(Number(logical))));
  return candles[index]?.time ?? null;
}

function timeToTimestamp(time: Time | null | undefined) {
  if (typeof time === "number") {
    return time;
  }

  return null;
}

function shouldAddBrushPoint(previous: DrawingAnchor, next: DrawingAnchor) {
  return previous.time !== next.time || Math.abs(previous.price - next.price) >= 0.25;
}

function colorForDrawing(type: ChartDrawing["type"]) {
  switch (type) {
    case "fib":
      return "#3b82f6";
    case "brush":
      return "#f97316";
    case "measure":
      return "#22d3ee";
    case "text":
      return "#e5e7eb";
    case "horizontal":
    case "trend":
    default:
      return "#f59e0b";
  }
}

function formatSignedNumber(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function createDrawingId(type: ChartDrawing["type"]) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

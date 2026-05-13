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
import { getSimpleSession } from "@/lib/backtest/sessions";
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
  magnetEnabled: boolean;
  drawings: ChartDrawing[];
  pendingDrawing: ChartDrawing | null;
  stopPoints: number;
  targetPoints: number;
  showSessionBands: boolean;
  onDrawingsChange: (drawings: ChartDrawing[]) => void;
  onPendingDrawingChange: (drawing: ChartDrawing | null) => void;
  onActivatePosition: (drawing: ChartDrawing) => void;
};

type ScreenPoint = {
  x: number;
  y: number;
};

type RenderedDrawing = {
  drawing: ChartDrawing;
  points: ScreenPoint[];
};

type SessionBandType = "asia" | "london" | "us";

type RenderedBand = {
  x1: number;
  x2: number;
  session: SessionBandType;
};

const SESSION_BAND_CONFIG: Record<SessionBandType, { fill: string; stroke: string; label: string }> = {
  asia: { fill: "rgba(148,163,184,0.07)", stroke: "rgba(148,163,184,0.18)", label: "Asia" },
  london: { fill: "rgba(56,189,248,0.07)", stroke: "rgba(56,189,248,0.18)", label: "London" },
  us: { fill: "rgba(250,204,21,0.07)", stroke: "rgba(250,204,21,0.18)", label: "US" },
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
  magnetEnabled,
  drawings,
  pendingDrawing,
  stopPoints,
  targetPoints,
  showSessionBands,
  onDrawingsChange,
  onPendingDrawingChange,
  onActivatePosition,
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
  const magnetEnabledRef = useRef(magnetEnabled);
  const candlesRef = useRef(candles);
  const drawingsRef = useRef(drawings);
  const pendingDrawingRef = useRef(pendingDrawing);
  const onDrawingsChangeRef = useRef(onDrawingsChange);
  const onPendingDrawingChangeRef = useRef(onPendingDrawingChange);
  const stopPointsRef = useRef(stopPoints);
  const targetPointsRef = useRef(targetPoints);
  const onActivatePositionRef = useRef(onActivatePosition);
  const brushDraftRef = useRef<ChartDrawing | null>(null);
  const [renderedDrawings, setRenderedDrawings] = useState<RenderedDrawing[]>([]);
  const [renderedBands, setRenderedBands] = useState<RenderedBand[]>([]);
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
    magnetEnabledRef.current = magnetEnabled;
    candlesRef.current = candles;
    drawingsRef.current = drawings;
    pendingDrawingRef.current = pendingDrawing;
    onDrawingsChangeRef.current = onDrawingsChange;
    onPendingDrawingChangeRef.current = onPendingDrawingChange;
    stopPointsRef.current = stopPoints;
    targetPointsRef.current = targetPoints;
    onActivatePositionRef.current = onActivatePosition;
  }, [activeDrawingTool, candles, drawings, magnetEnabled, onActivatePosition, onDrawingsChange, onPendingDrawingChange, pendingDrawing, stopPoints, targetPoints]);

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
      setRenderedBands(computeSessionBands(candlesRef.current, chart, nextSize.width));
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
    setRenderedBands(computeSessionBands(candles, chart, nextSize.width));
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

  function removeDrawing(drawingId: string) {
    const nextDrawings = drawingsRef.current.filter((drawing) => drawing.id !== drawingId);
    drawingsRef.current = nextDrawings;
    onDrawingsChangeRef.current(nextDrawings);
  }

  function anchorFromClientPoint(clientX: number, clientY: number, forceMagnet = false): DrawingAnchor | null {
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

    const anchor = {
      time,
      price: Number(price),
    };

    return magnetEnabledRef.current || forceMagnet ? snapAnchorToCandle(anchor, candlesRef.current) : anchor;
  }

  function handleDrawingClick(event: ReactMouseEvent<HTMLDivElement>) {
    const tool = activeDrawingToolRef.current;

    if (tool === "cursor" || tool === "brush") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const anchor = anchorFromClientPoint(event.clientX, event.clientY, event.ctrlKey || event.metaKey);

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

    if (tool === "vertical") {
      appendDrawing({
        id: createDrawingId("vertical"),
        type: "vertical",
        points: [anchor],
        color: colorForDrawing("vertical"),
      });
      setPendingDrawingLocal(null);
      return;
    }

    if (tool === "cross") {
      appendDrawing({
        id: createDrawingId("cross"),
        type: "cross",
        points: [anchor],
        color: colorForDrawing("cross"),
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

    if (tool === "long-position" || tool === "short-position") {
      const pending = pendingDrawingRef.current;

      if (pending && pending.type === tool) {
        const entryPrice = pending.points[0].price;
        const stopPrice = anchor.price;
        const riskDistance = Math.abs(entryPrice - stopPrice);

        if (riskDistance < 0.01) {
          return;
        }

        const rrRatio = stopPointsRef.current > 0 ? targetPointsRef.current / stopPointsRef.current : 1;
        const targetPrice =
          tool === "long-position"
            ? entryPrice + riskDistance * rrRatio
            : entryPrice - riskDistance * rrRatio;

        appendDrawing({
          ...pending,
          points: [
            pending.points[0],
            { time: pending.points[0].time, price: stopPrice },
            { time: pending.points[0].time, price: targetPrice },
          ],
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

    const anchor = anchorFromClientPoint(event.clientX, event.clientY, event.ctrlKey || event.metaKey);

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
    const tool = activeDrawingToolRef.current;

    if (tool === "long-position" || tool === "short-position") {
      const pending = pendingDrawingRef.current;

      if (!pending || pending.type !== tool || !pending.points[0]) {
        return;
      }

      const anchor = anchorFromClientPoint(event.clientX, event.clientY);

      if (!anchor) {
        return;
      }

      const entryPrice = pending.points[0].price;
      const stopPrice = anchor.price;
      const riskDistance = Math.abs(entryPrice - stopPrice);

      if (riskDistance < 0.01) {
        return;
      }

      const rrRatio = stopPointsRef.current > 0 ? targetPointsRef.current / stopPointsRef.current : 1;
      const targetPrice =
        tool === "long-position"
          ? entryPrice + riskDistance * rrRatio
          : entryPrice - riskDistance * rrRatio;

      setPendingDrawingLocal({
        ...pending,
        points: [
          pending.points[0],
          { time: pending.points[0].time, price: stopPrice },
          { time: pending.points[0].time, price: targetPrice },
        ],
      });
      return;
    }

    if (tool !== "brush" || !brushDraftRef.current) {
      return;
    }

    const anchor = anchorFromClientPoint(event.clientX, event.clientY, event.ctrlKey || event.metaKey);

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
      <svg className="absolute inset-0 z-10" width={overlaySize.width} height={overlaySize.height}>
        {showSessionBands
          ? renderedBands.map((band, i) => {
              const cfg = SESSION_BAND_CONFIG[band.session];
              const bw = band.x2 - band.x1;
              return (
                <g key={`band-${i}`} pointerEvents="none">
                  <rect x={band.x1} y={0} width={bw} height={overlaySize.height} fill={cfg.fill} />
                  <line x1={band.x1} x2={band.x1} y1={0} y2={overlaySize.height} stroke={cfg.stroke} strokeWidth={1} />
                  {bw > 52 ? (
                    <text x={band.x1 + 6} y={14} fill={cfg.stroke} fontSize={10} fontWeight={700} opacity={0.9}>
                      {cfg.label}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}
        {renderedDrawings.map(({ drawing, points }) => (
          <DrawingSvg
            key={drawing.id}
            drawing={drawing}
            points={points}
            width={overlaySize.width}
            height={overlaySize.height}
            removable={activeDrawingTool === "cursor"}
            onRemoveDrawing={removeDrawing}
            onActivatePosition={onActivatePosition}
          />
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
  height,
  removable,
  onRemoveDrawing,
  onActivatePosition,
}: {
  drawing: ChartDrawing;
  points: ScreenPoint[];
  width: number;
  height: number;
  removable: boolean;
  onRemoveDrawing: (drawingId: string) => void;
  onActivatePosition?: (drawing: ChartDrawing) => void;
}) {
  if (drawing.type === "horizontal" && points[0]) {
    return (
      <g>
        {removable ? (
          <line
            x1={0}
            x2={width}
            y1={points[0].y}
            y2={points[0].y}
            stroke="transparent"
            strokeWidth={16}
            pointerEvents="stroke"
            cursor="pointer"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemoveDrawing(drawing.id);
            }}
          />
        ) : null}
        <line x1={0} x2={width} y1={points[0].y} y2={points[0].y} stroke={drawing.color} strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />
        <AnchorPoint point={points[0]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "vertical" && points[0]) {
    return (
      <g pointerEvents="none">
        <line x1={points[0].x} x2={points[0].x} y1={0} y2={height} stroke={drawing.color} strokeWidth={1.5} strokeDasharray="6 4" />
        <AnchorPoint point={points[0]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "cross" && points[0]) {
    return (
      <g pointerEvents="none">
        <line x1={0} x2={width} y1={points[0].y} y2={points[0].y} stroke={drawing.color} strokeWidth={1.3} strokeDasharray="5 4" />
        <line x1={points[0].x} x2={points[0].x} y1={0} y2={height} stroke={drawing.color} strokeWidth={1.3} strokeDasharray="5 4" />
        <AnchorPoint point={points[0]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "rectangle" && points.length >= 2) {
    const left = Math.min(points[0].x, points[1].x);
    const top = Math.min(points[0].y, points[1].y);
    const boxWidth = Math.abs(points[1].x - points[0].x);
    const boxHeight = Math.abs(points[1].y - points[0].y);

    return (
      <g pointerEvents="none">
        <rect x={left} y={top} width={boxWidth} height={boxHeight} fill="rgba(59, 130, 246, 0.09)" stroke={drawing.color} strokeWidth={1.6} />
        <AnchorPoint point={points[0]} color={drawing.color} />
        <AnchorPoint point={points[1]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "trend" && points.length >= 2) {
    return (
      <g pointerEvents="none">
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
          pointerEvents="none"
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
      <g pointerEvents="none">
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
      <g pointerEvents="none">
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
      <g pointerEvents="none">
        <rect x={x - 6} y={y - 17} width={labelWidth} height={24} rx={4} fill="rgba(0, 0, 0, 0.82)" stroke="rgba(229, 231, 235, 0.32)" />
        <text x={x + 3} y={y} fill={drawing.color} fontSize={12} fontWeight={600}>
          {label}
        </text>
        <AnchorPoint point={points[0]} color={drawing.color} />
      </g>
    );
  }

  if (drawing.type === "long-position" || drawing.type === "short-position") {
    const isLong = drawing.type === "long-position";
    const accentColor = isLong ? "#22c55e" : "#ef4444";

    if (points.length < 3 || !drawing.points[1] || !drawing.points[2]) {
      if (!points[0]) {
        return null;
      }

      return (
        <g pointerEvents="none">
          <line x1={0} x2={width} y1={points[0].y} y2={points[0].y} stroke={accentColor} strokeWidth={1.5} strokeDasharray="6 4" />
          <rect x={Math.min(points[0].x + 10, width - 178)} y={points[0].y - 15} width={174} height={22} rx={4} fill="rgba(0,0,0,0.82)" stroke={accentColor} />
          <text x={Math.min(points[0].x + 18, width - 170)} y={points[0].y + 1} fill={accentColor} fontSize={11} fontWeight={600}>
            Click to set stop loss level
          </text>
          <AnchorPoint point={points[0]} color={accentColor} />
        </g>
      );
    }

    const entryPoint = points[0];
    const entryPrice = drawing.points[0].price;
    const stopPrice = drawing.points[1].price;
    const targetPrice = drawing.points[2].price;

    const entryY = entryPoint.y;
    const stopY = points[1].y;
    const targetY = points[2].y;

    const boxLeft = Math.max(0, entryPoint.x);
    const boxRight = width - 5;
    const boxWidth = Math.max(0, boxRight - boxLeft);

    const profitTop = Math.min(entryY, targetY);
    const profitHeight = Math.abs(entryY - targetY);
    const lossTop = Math.min(entryY, stopY);
    const lossHeight = Math.abs(entryY - stopY);

    const riskPts = Math.abs(entryPrice - stopPrice);
    const rewardPts = Math.abs(targetPrice - entryPrice);
    const rrRatio = riskPts > 0 ? rewardPts / riskPts : 0;

    const labelX = boxRight - 4;
    const minZone = 16;

    return (
      <g>
        <rect x={boxLeft} y={profitTop} width={boxWidth} height={profitHeight} fill="rgba(34,197,94,0.13)" pointerEvents="none" />
        <rect x={boxLeft} y={lossTop} width={boxWidth} height={lossHeight} fill="rgba(239,68,68,0.13)" pointerEvents="none" />

        <line x1={boxLeft} x2={boxRight} y1={targetY} y2={targetY} stroke="#22c55e" strokeWidth={1.5} pointerEvents="none" />
        <line x1={boxLeft} x2={boxRight} y1={entryY} y2={entryY} stroke="#d1d4dc" strokeWidth={1.5} pointerEvents="none" />
        <line x1={boxLeft} x2={boxRight} y1={stopY} y2={stopY} stroke="#ef4444" strokeWidth={1.5} pointerEvents="none" />

        {profitHeight >= minZone ? (
          <text x={labelX} y={profitTop + 13} fill="#22c55e" fontSize={11} fontWeight={600} textAnchor="end" pointerEvents="none">
            TP {formatPositionPrice(targetPrice)}
          </text>
        ) : null}

        {profitHeight >= 36 ? (
          <text x={boxLeft + Math.min(70, boxWidth * 0.4)} y={profitTop + profitHeight / 2 + 5} fill="rgba(34,197,94,0.75)" fontSize={11} fontWeight={700} pointerEvents="none">
            {rrRatio.toFixed(1)}:1
          </text>
        ) : null}

        <text x={labelX} y={entryY - 4} fill="#d1d4dc" fontSize={11} fontWeight={600} textAnchor="end" pointerEvents="none">
          {isLong ? "LONG" : "SHORT"} {formatPositionPrice(entryPrice)}
        </text>

        {lossHeight >= minZone ? (
          <text x={labelX} y={lossTop + lossHeight - 4} fill="#ef4444" fontSize={11} fontWeight={600} textAnchor="end" pointerEvents="none">
            SL {formatPositionPrice(stopPrice)}
          </text>
        ) : null}

        {removable ? (
          <>
            <g
              onClick={(e) => {
                e.stopPropagation();
                onActivatePosition?.(drawing);
              }}
              style={{ cursor: "pointer" }}
            >
              <rect x={boxLeft + 8} y={entryY - 26} width={108} height={24} rx={5} fill={isLong ? "#1a6e3c" : "#8b2332"} stroke={accentColor} strokeWidth={1} pointerEvents="all" />
              <text x={boxLeft + 62} y={entryY - 9} fill="#fff" fontSize={12} fontWeight={700} textAnchor="middle" pointerEvents="none">
                Place Order
              </text>
            </g>
            <g
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDrawing(drawing.id);
              }}
              style={{ cursor: "pointer" }}
            >
              <rect x={boxLeft + 8} y={entryY + 4} width={56} height={18} rx={4} fill="rgba(20,22,28,0.92)" stroke="rgba(120,124,132,0.4)" pointerEvents="all" />
              <text x={boxLeft + 36} y={entryY + 17} fill="#8a8f98" fontSize={10} textAnchor="middle" pointerEvents="none">
                Remove
              </text>
            </g>
          </>
        ) : null}

        <AnchorPoint point={entryPoint} color="#d1d4dc" />
      </g>
    );
  }

  if (points[0]) {
    return <AnchorPoint point={points[0]} color={drawing.color} />;
  }

  return null;
}

function AnchorPoint({ point, color }: { point: ScreenPoint; color: string }) {
  return <circle cx={point.x} cy={point.y} r={4} fill="#000" stroke={color} strokeWidth={2} pointerEvents="none" />;
}

function snapAnchorToCandle(anchor: DrawingAnchor, candles: Candle[]): DrawingAnchor {
  const candle = nearestCandle(candles, anchor.time);

  if (!candle) {
    return anchor;
  }

  const prices = [candle.open, candle.high, candle.low, candle.close];
  const price = prices.reduce((closest, candidate) =>
    Math.abs(candidate - anchor.price) < Math.abs(closest - anchor.price) ? candidate : closest,
  );

  return {
    time: candle.time,
    price,
  };
}

function nearestCandle(candles: Candle[], targetTime: number) {
  if (!candles.length) {
    return null;
  }

  let low = 0;
  let high = candles.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candle = candles[mid];

    if (candle.time === targetTime) {
      return candle;
    }

    if (candle.time < targetTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const before = candles[Math.max(0, high)];
  const after = candles[Math.min(candles.length - 1, low)];

  if (!before) {
    return after ?? null;
  }

  if (!after) {
    return before;
  }

  return Math.abs(before.time - targetTime) <= Math.abs(after.time - targetTime) ? before : after;
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
    case "vertical":
      return "#60a5fa";
    case "cross":
      return "#22d3ee";
    case "rectangle":
      return "#3b82f6";
    case "brush":
      return "#f97316";
    case "measure":
      return "#22d3ee";
    case "text":
      return "#e5e7eb";
    case "long-position":
      return "#22c55e";
    case "short-position":
      return "#ef4444";
    case "horizontal":
    case "trend":
    default:
      return "#f59e0b";
  }
}

function formatPositionPrice(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignedNumber(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function createDrawingId(type: ChartDrawing["type"]) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function computeSessionBands(candles: Candle[], chart: IChartApi, chartWidth: number): RenderedBand[] {
  if (!candles.length) return [];

  const bands: RenderedBand[] = [];
  let bandSession: SessionBandType | null = null;
  let bandStartTime = 0;
  let lastTime = 0;

  for (const candle of candles) {
    const session = getSimpleSession(candle.time);

    if (bandSession === null) {
      bandSession = session;
      bandStartTime = candle.time;
    } else if (session !== bandSession) {
      const x1 = chart.timeScale().timeToCoordinate(bandStartTime as UTCTimestamp);
      const x2 = chart.timeScale().timeToCoordinate(candle.time as UTCTimestamp);

      if (x1 !== null && x2 !== null) {
        const cx1 = Math.max(-1, Number(x1));
        const cx2 = Math.min(chartWidth + 1, Number(x2));
        if (cx2 > cx1) {
          bands.push({ x1: cx1, x2: cx2, session: bandSession });
        }
      }

      bandSession = session;
      bandStartTime = candle.time;
    }

    lastTime = candle.time;
  }

  if (bandSession !== null) {
    const x1 = chart.timeScale().timeToCoordinate(bandStartTime as UTCTimestamp);
    const x2raw = chart.timeScale().timeToCoordinate(lastTime as UTCTimestamp);

    if (x1 !== null) {
      const cx1 = Math.max(-1, Number(x1));
      const cx2 = x2raw !== null ? Math.min(chartWidth + 1, Number(x2raw) + 24) : chartWidth + 1;
      if (cx2 > cx1) {
        bands.push({ x1: cx1, x2: cx2, session: bandSession });
      }
    }
  }

  return bands;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Camera,
  ChevronDown,
  Crosshair,
  Database,
  Download,
  Eye,
  Layers,
  LineChart,
  Loader2,
  Lock,
  Magnet,
  Maximize2,
  Moon,
  Move,
  Pause,
  Pencil,
  Play,
  Plus,
  Ruler,
  Search,
  Settings,
  SlidersHorizontal,
  StepBack,
  StepForward,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { generateDemoCandles } from "@/lib/backtest/demo-data";
import { ema, rsi, vwap } from "@/lib/backtest/indicators";
import {
  ACTIVE_SNAPSHOT_ID,
  clearBacktesterStorage,
  createBacktesterDatasetId,
  loadBacktesterSession,
  saveBacktesterDataset,
  saveBacktesterSnapshot,
  type BacktesterSourceType,
} from "@/lib/backtest/local-db";
import {
  estimateBaseTimeframeMinutes,
  parseCsvCandles,
  resampleCandles,
  timeframeToMinutes,
} from "@/lib/backtest/market-data";
import { getSessionStartMarkers, sessionForTimestamp } from "@/lib/backtest/sessions";
import { closeTrade, createTrade, getTradeStats, maybeExitTradeOnCandle } from "@/lib/backtest/trades";
import type { Candle, ChartDrawing, DrawingTool, Timeframe, Trade, TradeSide } from "@/lib/backtest/types";
import { NQ_POINT_VALUE, NQ_TICK_SIZE, NQ_TICK_VALUE } from "@/lib/backtest/types";
import { ReplayChart } from "./replay-chart";
import { RsiPanel } from "./rsi-panel";

const timeframes: Timeframe[] = ["1m", "5m", "15m", "1h", "1d"];
const speedOptions = [1, 2, 5, 10, 25];

type LoadCandlesOptions = {
  datasetId?: string;
  persistDataset?: boolean;
  replayTime?: number | null;
  trades?: Trade[];
  drawings?: ChartDrawing[];
  pendingNote?: string;
};

export function NqBacktester() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timeframeRef = useRef<Timeframe>("1m");
  const hasHydratedRef = useRef(false);
  const [baseCandles, setBaseCandles] = useState<Candle[]>([]);
  const [sourceLabel, setSourceLabel] = useState("Loading NQ preview");
  const [sourceType, setSourceType] = useState<BacktesterSourceType>("empty");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [replayTime, setReplayTime] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stopPoints, setStopPoints] = useState(20);
  const [targetPoints, setTargetPoints] = useState(40);
  const [contracts, setContracts] = useState(1);
  const [pendingNote, setPendingNote] = useState("");
  const [status, setStatus] = useState("Requesting free data");
  const [isLoading, setIsLoading] = useState(true);
  const [showEma9, setShowEma9] = useState(true);
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(false);
  const [showVwap, setShowVwap] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [magnetEnabled, setMagnetEnabled] = useState(false);
  const [showSessionBands, setShowSessionBands] = useState(true);
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>("cursor");
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [pendingDrawing, setPendingDrawing] = useState<ChartDrawing | null>(null);
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState("Local DB starting");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const baseMinutes = useMemo(() => estimateBaseTimeframeMinutes(baseCandles), [baseCandles]);
  const availableTimeframes = useMemo(
    () => timeframes.filter((option) => timeframeToMinutes(option) >= baseMinutes),
    [baseMinutes],
  );
  const candles = useMemo(() => resampleCandles(baseCandles, timeframe), [baseCandles, timeframe]);
  const activeIndex = useMemo(() => findCandleIndexAtOrBefore(candles, replayTime), [candles, replayTime]);
  const currentTime = replayTime ?? 0;
  const baseActiveIndex = useMemo(() => findCandleIndexAtOrBefore(baseCandles, replayTime), [baseCandles, replayTime]);
  const visibleCandles = useMemo(() => {
    if (baseActiveIndex < 0) {
      return [];
    }

    return resampleCandles(baseCandles.slice(0, baseActiveIndex + 1), timeframe);
  }, [baseActiveIndex, baseCandles, timeframe]);
  const currentCandle = visibleCandles.at(-1);
  const previousCandle = visibleCandles.length > 1 ? visibleCandles.at(-2) : undefined;
  const allEma9 = useMemo(() => ema(visibleCandles, 9), [visibleCandles]);
  const allEma20 = useMemo(() => ema(visibleCandles, 20), [visibleCandles]);
  const allEma50 = useMemo(() => ema(visibleCandles, 50), [visibleCandles]);
  const allVwap = useMemo(() => vwap(visibleCandles), [visibleCandles]);
  const allRsi = useMemo(() => rsi(visibleCandles, 14), [visibleCandles]);
  const visibleTrades = useMemo(
    () =>
      trades
        .filter((trade) => currentTime > 0 && trade.entryTime <= currentTime)
        .map((trade) =>
          trade.exitTime !== undefined && trade.exitTime > currentTime
            ? {
                ...trade,
                exitIndex: undefined,
                exitTime: undefined,
                exitPrice: undefined,
                exitReason: undefined,
                pnl: undefined,
              }
            : trade,
        ),
    [currentTime, trades],
  );
  const openTrade = visibleTrades.find((trade) => !trade.exitTime);
  const stats = useMemo(() => getTradeStats(trades), [trades]);
  const session = currentTime ? sessionForTimestamp(currentTime) : null;
  const sessionMarkers = useMemo(() => getSessionStartMarkers(visibleCandles), [visibleCandles]);
  const progress = candles.length > 1 && activeIndex >= 0 ? activeIndex / (candles.length - 1) : 0;
  const sliderIndex = Math.max(activeIndex, 0);
  const priceChange = currentCandle && previousCandle ? currentCandle.close - previousCandle.close : 0;
  const priceChangePct = currentCandle && previousCandle ? (priceChange / previousCandle.close) * 100 : 0;

  const visibleEma9 = useMemo(() => filterToTime(allEma9, currentTime), [allEma9, currentTime]);
  const visibleEma20 = useMemo(() => filterToTime(allEma20, currentTime), [allEma20, currentTime]);
  const visibleEma50 = useMemo(() => filterToTime(allEma50, currentTime), [allEma50, currentTime]);
  const visibleVwap = useMemo(() => filterToTime(allVwap, currentTime), [allVwap, currentTime]);
  const visibleRsi = useMemo(() => filterToTime(allRsi, currentTime), [allRsi, currentTime]);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const loadCandles = useCallback((
    nextCandles: Candle[],
    label: string,
    nextSourceType: Exclude<BacktesterSourceType, "empty">,
    nextStatus: string,
    options: LoadCandlesOptions = {},
  ) => {
    const sorted = nextCandles
      .filter((candle) => [candle.open, candle.high, candle.low, candle.close, candle.time].every(Number.isFinite))
      .sort((a, b) => a.time - b.time);
    const datasetId = options.datasetId ?? createBacktesterDatasetId(label, nextSourceType, sorted);
    const estimatedBaseMinutes = estimateBaseTimeframeMinutes(sorted);
    const selectedMinutes = timeframeToMinutes(timeframeRef.current);
    const estimatedBars = Math.max(1, Math.floor((sorted.length * estimatedBaseMinutes) / selectedMinutes));
    const desiredWarmup = Math.max(20, Math.floor(estimatedBars * 0.2));
    const warmupIndex = Math.min(80, desiredWarmup, estimatedBars - 1);
    const warmupBaseIndex = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round((warmupIndex * selectedMinutes) / Math.max(estimatedBaseMinutes, 1))),
    );
    const nextReplayTime = options.replayTime ?? sorted[warmupBaseIndex]?.time ?? null;

    setBaseCandles(sorted);
    setActiveDatasetId(datasetId);
    setSourceLabel(label);
    setSourceType(nextSourceType);
    setStatus(nextStatus);
    setTrades(options.trades ?? []);
    setDrawings(options.drawings ?? []);
    setPendingNote(options.pendingNote ?? "");
    setReplayTime(nextReplayTime);
    setIsPlaying(false);

    if (options.persistDataset !== false && sorted.length) {
      void saveBacktesterDataset({
        id: datasetId,
        label,
        sourceType: nextSourceType,
        candles: sorted,
        barCount: sorted.length,
        rangeStart: sorted[0]?.time ?? null,
        rangeEnd: sorted.at(-1)?.time ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
        .then(() => setDbStatus("Dataset cached"))
        .catch((error) => setDbStatus(error instanceof Error ? error.message : "Local DB cache failed"));
    }
  }, []);

  const loadPreview = useCallback(async () => {
    setIsLoading(true);
    setStatus("Requesting Yahoo NQ=F");
    setSourceLabel("Loading Yahoo preview");
    setSourceType("empty");

    try {
      const response = await fetch("/api/market/nq?interval=5m&range=60d", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok || !Array.isArray(payload.candles) || payload.candles.length === 0) {
        throw new Error(payload.error ?? "No bars returned");
      }

      loadCandles(payload.candles, `Yahoo NQ=F ${payload.interval} ${payload.range}`, "real", "Yahoo preview loaded");
    } catch (error) {
      setBaseCandles([]);
      setActiveDatasetId(null);
      setTrades([]);
      setDrawings([]);
      setReplayTime(null);
      setStatus(error instanceof Error ? error.message : "Yahoo preview unavailable");
      setSourceLabel("CSV required for full history");
      setSourceType("empty");
    } finally {
      setIsLoading(false);
    }
  }, [loadCandles]);

  const loadLocalDataset = useCallback(async () => {
    setIsLoading(true);
    setStatus("Loading local Kaggle CSV");
    setSourceLabel("Dataset_NQ_1min_2022_2025.csv");
    setSourceType("empty");

    try {
      const response = await fetch("/api/market/nq/local", { cache: "no-store" });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Local dataset could not be loaded");
      }

      const text = await response.text();
      setStatus("Parsing local Kaggle CSV");
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const parsed = parseCsvCandles(text);

      if (!parsed.candles.length) {
        throw new Error("No valid OHLCV rows found in local CSV");
      }

      loadCandles(
        parsed.candles,
        `Local Kaggle NQ (${parsed.candles.length.toLocaleString()} bars)`,
        "real",
        `${parsed.rejectedRows} rows skipped`,
      );
    } catch (error) {
      setBaseCandles([]);
      setActiveDatasetId(null);
      setTrades([]);
      setDrawings([]);
      setReplayTime(null);
      setStatus(error instanceof Error ? error.message : "Local dataset unavailable");
      setSourceLabel("Local CSV failed");
      setSourceType("empty");
    } finally {
      setIsLoading(false);
    }
  }, [loadCandles]);

  useEffect(() => {
    let isCancelled = false;

    async function hydrateFromLocalDb() {
      setDbStatus("Opening local DB");

      try {
        const { snapshot, dataset } = await loadBacktesterSession();

        if (isCancelled) {
          return;
        }

        if (snapshot && dataset?.candles.length) {
          timeframeRef.current = snapshot.timeframe;
          setBaseCandles(dataset.candles);
          setActiveDatasetId(dataset.id);
          setSourceLabel(snapshot.sourceLabel || dataset.label);
          setSourceType(snapshot.sourceType);
          setStatus(snapshot.status || "Restored local session");
          setTimeframe(snapshot.timeframe);
          setReplayTime(snapshot.replayTime);
          setSpeed(snapshot.speed);
          setContracts(snapshot.contracts);
          setStopPoints(snapshot.stopPoints);
          setTargetPoints(snapshot.targetPoints);
          setPendingNote(snapshot.pendingNote);
          setTrades(snapshot.trades);
          setDrawings(snapshot.drawings);
          setShowEma9(snapshot.showEma9);
          setShowEma20(snapshot.showEma20);
          setShowEma50(snapshot.showEma50);
          setShowVwap(snapshot.showVwap);
          setShowRsi(snapshot.showRsi);
          setShowVolume(snapshot.showVolume);
          setMagnetEnabled(Boolean(snapshot.magnetEnabled));
          setIsPlaying(false);
          setIsLoading(false);
          setDbStatus("Restored local DB");
          setSavedAt(snapshot.updatedAt);
          hasHydratedRef.current = true;
          return;
        }
      } catch (error) {
        if (!isCancelled) {
          setDbStatus(error instanceof Error ? error.message : "Local DB unavailable");
        }
      }

      if (!isCancelled) {
        await loadPreview();
        hasHydratedRef.current = true;
      }
    }

    void hydrateFromLocalDb();

    return () => {
      isCancelled = true;
    };
  }, [loadPreview]);

  useEffect(() => {
    if (!availableTimeframes.includes(timeframe)) {
      setTimeframe(availableTimeframes[0] ?? "5m");
    }
  }, [availableTimeframes, timeframe]);

  useEffect(() => {
    if (!candles.length) {
      setReplayTime(null);
      return;
    }

    setReplayTime((time) => {
      if (time === null) {
        return candles[0].time;
      }

      if (time < candles[0].time) {
        return candles[0].time;
      }

      if (time > candles[candles.length - 1].time) {
        return candles[candles.length - 1].time;
      }

      return time;
    });
  }, [candles]);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const updatedAt = Date.now();

      void saveBacktesterSnapshot({
        id: ACTIVE_SNAPSHOT_ID,
        schemaVersion: 1,
        datasetId: activeDatasetId,
        updatedAt,
        sourceLabel,
        sourceType,
        status,
        timeframe,
        replayTime,
        speed,
        contracts,
        stopPoints,
        targetPoints,
        pendingNote,
        trades,
        drawings,
        showEma9,
        showEma20,
        showEma50,
        showVwap,
        showRsi,
        showVolume,
        magnetEnabled,
      })
        .then(() => {
          setSavedAt(updatedAt);
          setDbStatus("Saved locally");
        })
        .catch((error) => setDbStatus(error instanceof Error ? error.message : "Local DB save failed"));
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [
    activeDatasetId,
    contracts,
    drawings,
    magnetEnabled,
    pendingNote,
    replayTime,
    showEma9,
    showEma20,
    showEma50,
    showRsi,
    showVolume,
    showVwap,
    sourceLabel,
    sourceType,
    speed,
    status,
    stopPoints,
    targetPoints,
    timeframe,
    trades,
  ]);

  useEffect(() => {
    function handleUndoDrawing(event: KeyboardEvent) {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (!pendingDrawing && drawings.length === 0) {
        return;
      }

      event.preventDefault();

      if (pendingDrawing) {
        setPendingDrawing(null);
        return;
      }

      setDrawings((currentDrawings) => currentDrawings.slice(0, -1));
    }

    window.addEventListener("keydown", handleUndoDrawing);

    return () => window.removeEventListener("keydown", handleUndoDrawing);
  }, [drawings.length, pendingDrawing]);

  useEffect(() => {
    function handleDrawingShortcuts(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const tool = drawingToolForShortcut(key, event.altKey, event.shiftKey, event.ctrlKey, event.metaKey);

      if (!tool) {
        return;
      }

      event.preventDefault();
      setActiveDrawingTool(tool);
      setPendingDrawing(null);
    }

    window.addEventListener("keydown", handleDrawingShortcuts);

    return () => window.removeEventListener("keydown", handleDrawingShortcuts);
  }, []);

  const moveToIndex = useCallback(
    (targetIndex: number) => {
      if (!candles.length) {
        return;
      }

      const nextIndex = Math.max(0, Math.min(targetIndex, candles.length - 1));
      const nextTime = candles[nextIndex].time;

      setTrades((currentTrades) => {
        if (nextIndex < activeIndex) {
          return trimTradesToTime(currentTrades, nextTime);
        }

        return applyExitChecks(currentTrades, candles, activeIndex + 1, nextIndex);
      });
      setReplayTime(nextTime);
    },
    [activeIndex, candles],
  );

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    if (!candles.length || activeIndex >= candles.length - 1) {
      setIsPlaying(false);
      return;
    }

    const timer = window.setInterval(() => {
      moveToIndex(activeIndex + 1);
    }, Math.max(40, 1000 / speed));

    return () => window.clearInterval(timer);
  }, [activeIndex, candles.length, isPlaying, moveToIndex, speed]);

  async function handleFileImport(file: File) {
    setIsLoading(true);
    setStatus("Parsing CSV");

    try {
      const text = await file.text();
      const parsed = parseCsvCandles(text);

      if (!parsed.candles.length) {
        throw new Error("No valid OHLCV rows found");
      }

      loadCandles(parsed.candles, `${file.name} (${parsed.candles.length.toLocaleString()} bars)`, "real", `${parsed.rejectedRows} rows skipped`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "CSV import failed");
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function loadDemo() {
    loadCandles(generateDemoCandles(), "Demo sample", "demo", "Demo bars loaded");
  }

  function openPosition(side: TradeSide) {
    if (!currentCandle || openTrade) {
      return;
    }

    const trade = createTrade({
      side,
      candle: currentCandle,
      index: activeIndex,
      contracts,
      stopPoints,
      targetPoints,
      notes: pendingNote.trim() || undefined,
    });

    setTrades((currentTrades) => [...currentTrades, trade]);
    setPendingNote("");
  }

  function handleActivatePosition(drawing: ChartDrawing) {
    if ((drawing.type !== "long-position" && drawing.type !== "short-position") || !currentCandle || openTrade) {
      return;
    }

    const [entryAnchor, stopAnchor, targetAnchor] = drawing.points;

    if (!stopAnchor || !targetAnchor) {
      return;
    }

    const side: TradeSide = drawing.type === "long-position" ? "long" : "short";
    const plannedStop = Math.abs(entryAnchor.price - stopAnchor.price);
    const plannedTarget = Math.abs(targetAnchor.price - entryAnchor.price);
    const roundedStop = Math.max(NQ_TICK_SIZE, Math.round(plannedStop / NQ_TICK_SIZE) * NQ_TICK_SIZE);
    const roundedTarget = Math.max(NQ_TICK_SIZE, Math.round(plannedTarget / NQ_TICK_SIZE) * NQ_TICK_SIZE);

    const trade = createTrade({
      side,
      candle: currentCandle,
      index: activeIndex,
      contracts,
      stopPoints: roundedStop,
      targetPoints: roundedTarget,
      notes: pendingNote.trim() || undefined,
    });

    setDrawings((prev) => prev.filter((d) => d.id !== drawing.id));
    setTrades((prev) => [...prev, trade]);
    setPendingNote("");
    setActiveDrawingTool("cursor");
    setPendingDrawing(null);
  }

  function exitOpenTrade() {
    if (!currentCandle || !openTrade) {
      return;
    }

    const closedTrade = closeTrade(openTrade, currentCandle, activeIndex, currentCandle.close, "manual");
    setTrades((currentTrades) => currentTrades.map((trade) => (trade.id === closedTrade.id ? closedTrade : trade)));
  }

  function resetReplay() {
    setIsPlaying(false);
    setTrades([]);
    const resetIndex = candles.length ? Math.min(80, candles.length - 1) : -1;
    setReplayTime(resetIndex >= 0 ? candles[resetIndex].time : null);
  }

  function exportTrades() {
    const blob = new Blob([JSON.stringify({ sourceLabel, timeframe, trades }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nq-backtest-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function clearLocalSave() {
    try {
      hasHydratedRef.current = false;
      await clearBacktesterStorage();
      setBaseCandles([]);
      setActiveDatasetId(null);
      setSourceLabel("CSV required for full history");
      setSourceType("empty");
      setStatus("Local save cleared");
      setTrades([]);
      setDrawings([]);
      setPendingDrawing(null);
      setPendingNote("");
      setReplayTime(null);
      setIsPlaying(false);
      setSavedAt(null);
      setDbStatus("Local DB cleared");
    } catch (error) {
      setDbStatus(error instanceof Error ? error.message : "Local DB clear failed");
    } finally {
      window.setTimeout(() => {
        hasHydratedRef.current = true;
      }, 500);
    }
  }

  function selectDrawingTool(tool: DrawingTool) {
    setActiveDrawingTool(tool);
    setPendingDrawing(null);
  }

  const ohlcText = currentCandle
    ? `O ${formatPrice(currentCandle.open)} H ${formatPrice(currentCandle.high)} L ${formatPrice(currentCandle.low)} C ${formatPrice(currentCandle.close)}`
    : "O -- H -- L -- C --";
  const changeText = currentCandle ? `${formatSigned(priceChange)} (${formatSigned(priceChangePct)}%)` : "--";
  const chartTitle = `${sourceType === "demo" ? "Demo" : "NQ"} · ${timeframe} · CME E-mini Nasdaq-100`;

  return (
    <main className="h-screen overflow-hidden bg-black text-[#d1d4dc]">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleFileImport(file);
          }
        }}
      />

      <section className="grid h-screen grid-rows-[44px_minmax(0,1fr)_70px]">
        <header className="relative flex min-w-0 items-center border-b border-[#202124] bg-black text-sm">
          <ToolbarIcon title="Back">
            <ArrowLeft className="size-4" />
          </ToolbarIcon>
          <div className="flex h-full min-w-[128px] items-center gap-2 border-r border-[#202124] px-3 text-[#c8c8c8]">
            <Search className="size-4 text-[#8a8f98]" />
            <span className="font-bold tracking-wide text-[#d7d7d7]">NQ</span>
          </div>
          <ToolbarIcon title="Add data">
            <Plus className="size-5" />
          </ToolbarIcon>
          <ToolbarDivider />
          <div className="hidden h-full items-center gap-1 px-2 sm:flex">
            {timeframes.map((option) => (
              <button
                key={option}
                type="button"
                disabled={!availableTimeframes.includes(option)}
                onClick={() => setTimeframe(option)}
                className={`h-8 min-w-10 px-2 font-semibold transition ${
                  timeframe === option ? "text-white" : "text-[#aaa] hover:text-white"
                } disabled:cursor-not-allowed disabled:text-[#3b3d42]`}
              >
                {option}
              </button>
            ))}
          </div>
          <ToolbarDivider />
          <button
            type="button"
            onClick={() => setShowVwap((value) => !value)}
            className="hidden h-full items-center gap-2 px-3 font-semibold text-[#c8c8c8] transition hover:text-white md:inline-flex"
          >
            <SlidersHorizontal className="size-4" />
            Indicators
          </button>
          <ToolbarDivider />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-full items-center gap-2 px-3 font-semibold text-[#c8c8c8] transition hover:text-white"
          >
            <Upload className="size-4" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => void loadPreview()}
            className="inline-flex h-full items-center gap-2 px-3 font-semibold text-[#c8c8c8] transition hover:text-white"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
            Yahoo
          </button>
          <button
            type="button"
            onClick={() => void loadLocalDataset()}
            className="inline-flex h-full items-center gap-2 px-3 font-semibold text-[#c8c8c8] transition hover:text-white"
          >
            <Database className="size-4" />
            Local
          </button>
          <button
            type="button"
            onClick={loadDemo}
            className="inline-flex h-full items-center px-3 font-bold text-[#facc15] transition hover:text-white"
          >
            Demo
          </button>
          <div className="ml-auto hidden h-full items-center gap-2 border-l border-[#202124] px-3 text-xs text-[#8a8f98] lg:flex">
            <span className={sourceType === "demo" ? "text-[#facc15]" : "text-[#c8c8c8]"}>{sourceLabel}</span>
            <span className="max-w-[260px] truncate">{status}</span>
          </div>
          <ToolbarIcon title="Theme">
            <Moon className="size-4" />
          </ToolbarIcon>
          <ToolbarIcon title="Fullscreen">
            <Maximize2 className="size-4" />
          </ToolbarIcon>

          <div className="pointer-events-auto absolute left-1/2 top-1/2 hidden h-10 -translate-x-1/2 -translate-y-1/2 items-center gap-4 rounded-md border border-[#2c2e33] bg-black px-4 shadow-[0_8px_32px_rgba(0,0,0,0.65)] xl:flex">
            <button type="button" title="Reset" onClick={resetReplay} className="text-[#8a8f98] hover:text-white">
              <StepBack className="size-5" />
            </button>
            <button type="button" title={isPlaying ? "Pause" : "Play"} onClick={() => setIsPlaying((value) => !value)} disabled={!candles.length} className="text-[#d1d4dc] hover:text-white disabled:opacity-30">
              {isPlaying ? <Pause className="size-5" /> : <Play className="size-5 fill-current" />}
            </button>
            <span className="min-w-8 text-center text-base font-bold text-white">{timeframe}</span>
            <button type="button" title="Step forward" onClick={() => moveToIndex(activeIndex + 1)} disabled={!candles.length || activeIndex >= candles.length - 1} className="text-[#8a8f98] hover:text-white disabled:opacity-30">
              <StepForward className="size-5" />
            </button>
            <button type="button" className="inline-flex items-center gap-1 text-[#d1d4dc]">
              {speed}x
              <ChevronDown className="size-4" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[48px_minmax(0,1fr)] xl:grid-cols-[48px_minmax(0,1fr)_330px_52px]">
          <nav className="flex min-h-0 flex-col items-center border-r border-[#202124] bg-black py-2">
            <RailButton title="Crosshair" active={activeDrawingTool === "cursor"} onClick={() => selectDrawingTool("cursor")}>
              <Crosshair className="size-5" />
            </RailButton>
            <RailButton title="Trend line" active={activeDrawingTool === "trend"} onClick={() => selectDrawingTool("trend")}>
              <LineChart className="size-5" />
            </RailButton>
            <RailButton title="Horizontal line" active={activeDrawingTool === "horizontal"} onClick={() => selectDrawingTool("horizontal")}>
              <MinusIcon />
            </RailButton>
            <RailButton title="Vertical line" active={activeDrawingTool === "vertical"} onClick={() => selectDrawingTool("vertical")}>
              <VerticalIcon />
            </RailButton>
            <RailButton title="Cross line" active={activeDrawingTool === "cross"} onClick={() => selectDrawingTool("cross")}>
              <CrossLineIcon />
            </RailButton>
            <RailButton title="Rectangle" active={activeDrawingTool === "rectangle"} onClick={() => selectDrawingTool("rectangle")}>
              <RectangleIcon />
            </RailButton>
            <RailButton title="Fib retracement" active={activeDrawingTool === "fib"} onClick={() => selectDrawingTool("fib")}>
              <FibIcon />
            </RailButton>
            <RailButton title="Brush" active={activeDrawingTool === "brush"} onClick={() => selectDrawingTool("brush")}>
              <Pencil className="size-5" />
            </RailButton>
            <RailButton title="Text" active={activeDrawingTool === "text"} onClick={() => selectDrawingTool("text")}>
              <Type className="size-5" />
            </RailButton>
            <RailButton title="Measure" active={activeDrawingTool === "measure"} onClick={() => selectDrawingTool("measure")}>
              <Ruler className="size-5" />
            </RailButton>
            <RailButton title="Long Position (Alt+L)" active={activeDrawingTool === "long-position"} onClick={() => selectDrawingTool("long-position")}>
              <LongPositionIcon />
            </RailButton>
            <RailButton title="Short Position (Alt+Shift+L)" active={activeDrawingTool === "short-position"} onClick={() => selectDrawingTool("short-position")}>
              <ShortPositionIcon />
            </RailButton>
            <RailDivider />
            <RailButton title="Magnet" active={magnetEnabled} onClick={() => setMagnetEnabled((value) => !value)}>
              <Magnet className="size-5" />
            </RailButton>
            <RailButton title="Lock">
              <Lock className="size-5" />
            </RailButton>
            <RailButton title="Hide">
              <Eye className="size-5" />
            </RailButton>
            <div className="mt-auto" />
            <RailButton
              title="Clear"
              onClick={() => {
                setDrawings([]);
                setPendingDrawing(null);
              }}
            >
              <Trash2 className="size-5" />
            </RailButton>
          </nav>

          <section className="relative min-h-0 overflow-hidden bg-black">
            <div className="pointer-events-none absolute left-4 top-3 z-20 max-w-[calc(100%-2rem)] text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-[#d1d4dc]">{chartTitle}</span>
                <span className={priceChange >= 0 ? "text-[#2fb371]" : "text-[#e04f5f]"}>{ohlcText}</span>
                <span className={priceChange >= 0 ? "text-[#2fb371]" : "text-[#e04f5f]"}>{changeText}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[#9aa0a6]">
                <span>Volume</span>
                <span className={priceChange >= 0 ? "text-[#2fb371]" : "text-[#e04f5f]"}>
                  {currentCandle ? compactNumber(currentCandle.volume) : "--"}
                </span>
                {session ? <span style={{ color: session.color }}>{session.label}</span> : null}
              </div>
            </div>

            {visibleCandles.length ? (
              <div className="absolute inset-0">
                <ReplayChart
                  candles={visibleCandles}
                  ema9={visibleEma9}
                  ema20={visibleEma20}
                  ema50={visibleEma50}
                  vwap={visibleVwap}
                  trades={visibleTrades}
                  sessionMarkers={sessionMarkers}
                  showEma9={showEma9}
                  showEma20={showEma20}
                  showEma50={showEma50}
                  showVwap={showVwap}
                  showVolume={showVolume}
                  openTrade={openTrade}
                  activeDrawingTool={activeDrawingTool}
                  magnetEnabled={magnetEnabled}
                  drawings={drawings}
                  pendingDrawing={pendingDrawing}
                  stopPoints={stopPoints}
                  targetPoints={targetPoints}
                  showSessionBands={showSessionBands}
                  onDrawingsChange={setDrawings}
                  onPendingDrawingChange={setPendingDrawing}
                  onActivatePosition={handleActivatePosition}
                />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-center">
                <div>
                  {isLoading ? <Loader2 className="mx-auto size-7 animate-spin text-[#6ea8fe]" /> : <Upload className="mx-auto size-7 text-[#6f7681]" />}
                  <p className="mt-3 text-sm font-semibold text-[#d1d4dc]">No candles loaded</p>
                  <p className="mt-1 text-xs text-[#7b8088]">{status}</p>
                </div>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 z-20">
              <RsiPanel points={visibleRsi} visible={showRsi} />
            </div>
          </section>

          <aside className="hidden min-h-0 overflow-auto border-l border-[#202124] bg-black xl:block">
            <SideSection title="Object tree">
              <div className="flex gap-5 text-[#575c65]">
                <Layers className="size-5" />
                <Plus className="size-5" />
                <Move className="size-5" />
              </div>
              <div className="mt-8 space-y-5">
                <TreeRow icon={<BarChart3 className="size-5" />} label={`NQ · CME, ${timeframe}`} />
                {showVolume ? <TreeRow icon={<LineChart className="size-5" />} label="Volume" muted /> : null}
                {showVwap ? <TreeRow icon={<LineChart className="size-5" />} label="VWAP" muted /> : null}
                {showEma9 ? <TreeRow icon={<LineChart className="size-5" />} label="EMA 9" muted /> : null}
                {showEma20 ? <TreeRow icon={<LineChart className="size-5" />} label="EMA 20" muted /> : null}
                {drawings.length ? <TreeRow icon={<Pencil className="size-5" />} label={`${drawings.length} drawing${drawings.length === 1 ? "" : "s"}`} muted /> : null}
              </div>
            </SideSection>

            <SideSection title="Order">
              <div className="grid grid-cols-3 gap-2">
                <TerminalNumber label="Qty" value={contracts} min={1} step={1} onChange={setContracts} />
                <TerminalNumber label="Stop" value={stopPoints} min={NQ_TICK_SIZE} step={NQ_TICK_SIZE} onChange={setStopPoints} />
                <TerminalNumber label="Target" value={targetPoints} min={NQ_TICK_SIZE} step={NQ_TICK_SIZE} onChange={setTargetPoints} />
              </div>
              <textarea
                value={pendingNote}
                onChange={(event) => setPendingNote(event.target.value)}
                placeholder="Trade note"
                className="mt-3 h-20 w-full resize-none border border-[#24272d] bg-black p-3 text-sm text-[#d1d4dc] outline-none placeholder:text-[#5f646d] focus:border-[#3f83f8]"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <TradeButton side="buy" disabled={!currentCandle || Boolean(openTrade)} onClick={() => openPosition("long")} />
                <TradeButton side="sell" disabled={!currentCandle || Boolean(openTrade)} onClick={() => openPosition("short")} />
              </div>
              <button
                type="button"
                disabled={!openTrade || !currentCandle}
                onClick={exitOpenTrade}
                className="mt-2 h-10 w-full border border-[#24272d] text-sm font-bold text-[#c8c8c8] transition hover:border-[#3b4048] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                Manual Exit
              </button>
              <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                <PlainStat label="Tick" value={`${NQ_TICK_SIZE} / $${NQ_TICK_VALUE}`} />
                <PlainStat label="Point" value={`$${NQ_POINT_VALUE}`} />
                {openTrade ? (
                  <>
                    <PlainStat label="Entry" value={formatPrice(openTrade.entryPrice)} />
                    <PlainStat label="SL / TP" value={`${formatPrice(openTrade.stopPrice)} / ${formatPrice(openTrade.targetPrice)}`} />
                  </>
                ) : null}
              </div>
            </SideSection>

            <SideSection title="Indicators">
              <div className="grid gap-3">
                <TerminalToggle label="EMA 9" checked={showEma9} onChange={setShowEma9} />
                <TerminalToggle label="EMA 20" checked={showEma20} onChange={setShowEma20} />
                <TerminalToggle label="EMA 50" checked={showEma50} onChange={setShowEma50} />
                <TerminalToggle label="VWAP" checked={showVwap} onChange={setShowVwap} />
                <TerminalToggle label="RSI" checked={showRsi} onChange={setShowRsi} />
                <TerminalToggle label="Volume" checked={showVolume} onChange={setShowVolume} />
                <div className="mt-1 border-t border-[#202124] pt-3">
                  <p className="mb-2 text-[11px] font-bold uppercase text-[#7b8088]">Sessions</p>
                  <TerminalToggle label="Asia / London / US bands" checked={showSessionBands} onChange={setShowSessionBands} />
                </div>
              </div>
            </SideSection>

            <SideSection title="Journal">
              <div className="space-y-4">
                {stats.closedTrades.length ? (
                  stats.closedTrades
                    .slice()
                    .reverse()
                    .slice(0, 6)
                    .map((trade) => (
                      <div key={trade.id} className="border-b border-[#17191d] pb-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold uppercase text-[#d1d4dc]">{trade.side}</span>
                          <span className={(trade.pnl ?? 0) >= 0 ? "text-[#2fb371]" : "text-[#e04f5f]"}>{formatMoney(trade.pnl ?? 0)}</span>
                        </div>
                        <p className="mt-1 text-xs text-[#777d86]">
                          {trade.exitReason ?? "manual"} · {formatDateTime(trade.entryTime)}
                        </p>
                        {trade.notes ? <p className="mt-2 text-xs leading-5 text-[#b4b8bf]">{trade.notes}</p> : null}
                      </div>
                    ))
                ) : (
                  <p className="text-sm text-[#777d86]">No closed trades</p>
                )}
              </div>
            </SideSection>

            <SideSection title="Analysis">
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                <PlainStat label="Win Rate" value={formatPercent(stats.winRate)} />
                <PlainStat label="Profit Factor" value={formatRatio(stats.profitFactor)} />
                <PlainStat label="Expectancy" value={formatMoney(stats.expectancy)} />
                <PlainStat label="Avg Trade" value={formatMoney(stats.averageTrade)} />
                <PlainStat label="Avg Win" value={formatMoney(stats.averageWin)} />
                <PlainStat label="Avg Loss" value={formatMoney(-stats.averageLoss)} />
              </div>
            </SideSection>

            <SideSection title="Data">
              <div className="grid gap-3 text-sm">
                <PlainStat label="Bars" value={candles.length ? candles.length.toLocaleString() : "--"} />
                <PlainStat label="Range" value={formatRange(candles)} />
                <PlainStat label="Mode" value={sourceType} />
                <PlainStat label="Local DB" value={dbStatus} />
                <PlainStat label="Saved" value={savedAt ? formatSavedTime(savedAt) : "--"} />
                <PlainStat label="Dataset" value={activeDatasetId ? "cached" : "--"} />
                <button
                  type="button"
                  onClick={() => void clearLocalSave()}
                  className="inline-flex h-9 items-center gap-2 text-sm font-semibold text-[#c8c8c8] transition hover:text-white"
                >
                  <Trash2 className="size-4" />
                  Clear save
                </button>
                <a className="font-semibold text-[#8ab4f8] hover:text-white" href="https://www.kaggle.com/datasets/tgtanalytics/nq-futures-1min-bar-2022-2025" target="_blank" rel="noreferrer">
                  NQ Futures - 1min Bar 2022 2025
                </a>
                <button
                  type="button"
                  onClick={exportTrades}
                  disabled={!trades.length}
                  className="inline-flex h-9 items-center gap-2 text-sm font-semibold text-[#c8c8c8] transition hover:text-white disabled:opacity-30"
                >
                  <Download className="size-4" />
                  Export trades
                </button>
              </div>
            </SideSection>
          </aside>

          <nav className="hidden min-h-0 flex-col items-center border-l border-[#202124] bg-black py-2 xl:flex">
            <RailButton title="Layers" active>
              <Layers className="size-5" />
            </RailButton>
            <div className="mt-auto flex flex-col items-center gap-3 text-[11px] text-[#9aa0a6]">
              <RightRailItem icon={<Plus className="size-5" />} label="Order" />
              <RightRailItem icon={<ArrowRight className="size-5" />} label="Go to" />
              <RightRailItem icon={<Camera className="size-5" />} label="Shot" />
              <RightRailItem icon={<Settings className="size-5" />} label="Settings" />
            </div>
          </nav>
        </div>

        <footer className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-t border-[#202124] bg-black px-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!currentCandle || Boolean(openTrade)}
              onClick={() => openPosition("long")}
              className="h-11 rounded-full bg-[#1f8f50] px-5 text-sm font-bold text-white transition hover:bg-[#2fb371] disabled:bg-[#1b1d20] disabled:text-[#555b63]"
            >
              Buy
            </button>
            <button
              type="button"
              disabled={!currentCandle || Boolean(openTrade)}
              onClick={() => openPosition("short")}
              className="h-11 rounded-full bg-[#a52c38] px-5 text-sm font-bold text-white transition hover:bg-[#d63d4d] disabled:bg-[#1b1d20] disabled:text-[#555b63]"
            >
              Sell
            </button>
            <label className="hidden h-11 min-w-[160px] items-center justify-between rounded-lg border border-[#24272d] px-3 text-[#9aa0a6] sm:flex">
              <span>Quantity</span>
              <input
                type="number"
                min={1}
                step={1}
                value={contracts}
                onChange={(event) => setContracts(Math.max(1, Number(event.target.value) || 1))}
                className="w-14 bg-transparent text-right font-bold text-[#d1d4dc] outline-none"
              />
            </label>
          </div>

          <div className="grid min-w-0 gap-2">
            <input
              type="range"
              min={0}
              max={Math.max(0, candles.length - 1)}
              value={sliderIndex}
              disabled={!candles.length}
              onChange={(event) => moveToIndex(Number(event.target.value))}
              className="h-1 w-full accent-[#2962ff]"
              aria-label="Replay timeline"
            />
            <div className="flex items-center justify-between text-xs text-[#8a8f98]">
              <span>{candles[0] ? formatDateTime(candles[0].time) : "--"}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={resetReplay} className="hover:text-white">
                  <StepBack className="size-4" />
                </button>
                <button type="button" onClick={() => setIsPlaying((value) => !value)} disabled={!candles.length} className="hover:text-white disabled:opacity-30">
                  {isPlaying ? <Pause className="size-4" /> : <Play className="size-4 fill-current" />}
                </button>
                <button type="button" onClick={() => moveToIndex(activeIndex + 1)} disabled={!candles.length || activeIndex >= candles.length - 1} className="hover:text-white disabled:opacity-30">
                  <StepForward className="size-4" />
                </button>
                <select
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                  className="bg-black text-xs font-bold text-[#d1d4dc] outline-none"
                  aria-label="Replay speed"
                >
                  {speedOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}x
                    </option>
                  ))}
                </select>
              </div>
              <span>{currentTime ? formatDateTime(currentTime) : "--"}</span>
            </div>
          </div>

          <div className="hidden items-center gap-8 text-sm lg:flex">
            <BottomMetric label="Progress" value={`${Math.round(progress * 100)}%`} />
            <BottomMetric label="Realized PnL" value={formatMoney(stats.totalPnl)} tone={stats.totalPnl >= 0 ? "positive" : "negative"} />
            <BottomMetric label="Win Rate" value={formatPercent(stats.winRate)} />
            <BottomMetric label="Trades" value={String(stats.closedTrades.length)} />
          </div>
        </footer>
      </section>
    </main>
  );
}

function applyExitChecks(trades: Trade[], candles: Candle[], fromIndex: number, toIndex: number) {
  const openTrade = trades.find((trade) => !trade.exitTime);

  if (!openTrade || fromIndex > toIndex) {
    return trades;
  }

  for (let index = fromIndex; index <= toIndex; index += 1) {
    const candle = candles[index];
    const closedTrade = candle ? maybeExitTradeOnCandle(openTrade, candle, index) : null;

    if (closedTrade) {
      return trades.map((trade) => (trade.id === closedTrade.id ? closedTrade : trade));
    }
  }

  return trades;
}

function trimTradesToTime(trades: Trade[], time: number) {
  return trades.flatMap((trade) => {
    if (trade.entryTime > time) {
      return [];
    }

    if (trade.exitTime !== undefined && trade.exitTime > time) {
      return [
        {
          ...trade,
          exitIndex: undefined,
          exitTime: undefined,
          exitPrice: undefined,
          exitReason: undefined,
          pnl: undefined,
        },
      ];
    }

    return [trade];
  });
}

function filterToTime(points: Array<{ time: number; value: number }>, time: number) {
  return points.filter((point) => point.time <= time);
}

function findCandleIndexAtOrBefore(candles: Candle[], time: number | null) {
  if (!candles.length || time === null) {
    return -1;
  }

  let low = 0;
  let high = candles.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (candles[mid].time <= time) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function drawingToolForShortcut(
  key: string,
  altKey: boolean,
  shiftKey: boolean,
  ctrlKey: boolean,
  metaKey: boolean,
): DrawingTool | null {
  if (!altKey || ctrlKey || metaKey) {
    return null;
  }

  if (shiftKey) {
    if (key === "r") return "rectangle";
    if (key === "l") return "short-position";
    return null;
  }

  switch (key) {
    case "t":
      return "trend";
    case "h":
      return "horizontal";
    case "v":
      return "vertical";
    case "c":
      return "cross";
    case "f":
      return "fib";
    case "l":
      return "long-position";
    default:
      return null;
  }
}

function ToolbarIcon({ children, title }: { children: ReactNode; title: string }) {
  return (
    <button type="button" title={title} aria-label={title} className="inline-flex h-full w-11 items-center justify-center text-[#b5bac2] transition hover:bg-[#111316] hover:text-white">
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="h-6 w-px bg-[#202124]" />;
}

function RailButton({
  children,
  title,
  active,
  onClick,
}: {
  children: ReactNode;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`mb-1 inline-flex size-10 items-center justify-center rounded-md transition ${
        active ? "bg-[#30343a] text-white" : "text-[#aeb4bc] hover:bg-[#111316] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path d="M4 12h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function VerticalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path d="M12 4v16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CrossLineIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path d="M4 12h16M12 4v16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RectangleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <rect x="5" y="6" width="14" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" rx="1.5" />
    </svg>
  );
}

function FibIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path d="M4 5h16M4 9h16M4 13h16M4 17h16M4 21h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6 5v16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

function LongPositionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <rect x="4" y="4" width="16" height="7" rx="1" fill="rgba(34,197,94,0.28)" stroke="#22c55e" strokeWidth="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1" fill="rgba(239,68,68,0.22)" stroke="#ef4444" strokeWidth="1.5" />
      <line x1="4" x2="20" y1="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ShortPositionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <rect x="4" y="4" width="16" height="7" rx="1" fill="rgba(239,68,68,0.22)" stroke="#ef4444" strokeWidth="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1" fill="rgba(34,197,94,0.28)" stroke="#22c55e" strokeWidth="1.5" />
      <line x1="4" x2="20" y1="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function RailDivider() {
  return <span className="my-2 h-px w-8 bg-[#202124]" />;
}

function RightRailItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button type="button" className="grid justify-items-center gap-1 text-[#aeb4bc] transition hover:text-white">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-[#202124] px-5 py-5">
      <h2 className="mb-4 text-sm font-bold text-[#c8c8c8]">{title}</h2>
      {children}
    </section>
  );
}

function TreeRow({ icon, label, muted }: { icon: ReactNode; label: string; muted?: boolean }) {
  return (
    <div className={`flex items-center gap-4 text-sm ${muted ? "text-[#aaa]" : "font-semibold text-[#d1d4dc]"}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function TerminalNumber({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase text-[#7b8088]">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))}
        className="h-10 w-full border border-[#24272d] bg-black px-2 text-sm font-bold text-[#d1d4dc] outline-none focus:border-[#3f83f8]"
      />
    </label>
  );
}

function TradeButton({ side, disabled, onClick }: { side: "buy" | "sell"; disabled: boolean; onClick: () => void }) {
  const isBuy = side === "buy";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-11 items-center justify-center gap-2 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-30 ${
        isBuy ? "bg-[#1f8f50] hover:bg-[#2fb371]" : "bg-[#b83240] hover:bg-[#d63d4d]"
      }`}
    >
      {isBuy ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
      {isBuy ? "Market Buy" : "Market Sell"}
    </button>
  );
}

function TerminalToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-[#d1d4dc]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[#3f83f8]"
      />
    </label>
  );
}

function PlainStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase text-[#777d86]">{label}</p>
      <p className="mt-1 truncate font-semibold text-[#d1d4dc]">{value}</p>
    </div>
  );
}

function BottomMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div>
      <p className="text-xs text-[#8a8f98]">{label}</p>
      <p className={`font-semibold ${tone === "positive" ? "text-[#2fb371]" : tone === "negative" ? "text-[#e04f5f]" : "text-[#d1d4dc]"}`}>
        {value}
      </p>
    </div>
  );
}

function formatPrice(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSigned(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatRatio(value: number) {
  if (!Number.isFinite(value)) {
    return "Inf";
  }

  return value.toFixed(2);
}

function formatSavedTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function formatRange(candles: Candle[]) {
  if (!candles.length) {
    return "--";
  }

  return `${formatDateTime(candles[0].time)} - ${formatDateTime(candles.at(-1)!.time)}`;
}

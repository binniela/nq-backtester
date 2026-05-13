"use client";

import type { IndicatorPoint } from "@/lib/backtest/types";

type RsiPanelProps = {
  points: IndicatorPoint[];
  visible: boolean;
};

export function RsiPanel({ points, visible }: RsiPanelProps) {
  if (!visible) {
    return null;
  }

  const latest = points.at(-1)?.value;
  const path = buildPath(points.slice(-220), 100, 48);

  return (
    <div className="grid h-20 grid-cols-[76px_minmax(0,1fr)] items-center gap-3 border-t border-[#242a32] bg-[#0b0d10] px-4">
      <div>
        <p className="text-xs font-semibold uppercase text-[#9ca3af]">RSI 14</p>
        <p className={`mt-1 text-lg font-bold ${getRsiColor(latest)}`}>{latest === undefined ? "--" : latest.toFixed(1)}</p>
      </div>
      <svg viewBox="0 0 100 48" preserveAspectRatio="none" className="h-12 w-full overflow-visible">
        <line x1="0" x2="100" y1="14.4" y2="14.4" stroke="rgba(248, 113, 113, 0.45)" strokeDasharray="3 3" />
        <line x1="0" x2="100" y1="33.6" y2="33.6" stroke="rgba(34, 197, 94, 0.45)" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="#facc15" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function buildPath(points: IndicatorPoint[], width: number, height: number) {
  if (points.length < 2) {
    return "";
  }

  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - (Math.max(0, Math.min(100, point.value)) / 100) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function getRsiColor(value?: number) {
  if (value === undefined) {
    return "text-[#e5e7eb]";
  }

  if (value >= 70) {
    return "text-[#f87171]";
  }

  if (value <= 30) {
    return "text-[#22c55e]";
  }

  return "text-[#e5e7eb]";
}

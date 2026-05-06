"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PolymarketHistoryPoint,
  PolymarketHistoryResponse,
  PolymarketHistoryRow,
  PolymarketHistoryWindow,
  PolymarketHistoryWindowId,
} from "@/lib/types";

type MarketPriceHistoryTableProps = {
  data: PolymarketHistoryResponse | null;
  emptyMessage?: string | null;
  error: string | null;
  loading: boolean;
};

type HistoryView = "price" | "trend";

type TimelineColumn = {
  axisLabel: string;
  label: string;
  ts: number;
};

type TrendSeries = {
  bracket: string;
  color: string;
  latestValue: number | null;
  values: Array<number | null>;
};

type TrendChartPoint = {
  x: number;
  y: number;
};

const LOW_COLOR = { blue: 39, green: 38, red: 28 };
const MID_COLOR = { blue: 87, green: 73, red: 85 };
const HIGH_COLOR = { blue: 90, green: 139, red: 80 };
const HISTORY_TIMEZONE = "America/New_York";
const TREND_SERIES_COLORS = ["#ff685a", "#f0d75d", "#91ff5f", "#69f0b2", "#61a9ff", "#7e65ff"];
const VIEW_DEFAULT_WINDOWS: Record<HistoryView, PolymarketHistoryWindowId> = {
  price: "1h",
  trend: "24h",
};

const HISTORY_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "short",
  timeZone: HISTORY_TIMEZONE,
  timeZoneName: "short",
});

const TREND_AXIS_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "short",
  timeZone: HISTORY_TIMEZONE,
});

function interpolateChannel(start: number, end: number, ratio: number) {
  return Math.round(start + (end - start) * ratio);
}

function getGradientColor(ratio: number) {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const pivot = 0.5;
  const startColor = clampedRatio < pivot ? LOW_COLOR : MID_COLOR;
  const endColor = clampedRatio < pivot ? MID_COLOR : HIGH_COLOR;
  const localRatio = clampedRatio < pivot ? clampedRatio / pivot : (clampedRatio - pivot) / pivot;

  return {
    blue: interpolateChannel(startColor.blue, endColor.blue, localRatio),
    green: interpolateChannel(startColor.green, endColor.green, localRatio),
    red: interpolateChannel(startColor.red, endColor.red, localRatio),
  };
}

function formatHistoryValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }

  return value.toFixed(1);
}

function formatHistoryTimestamp(ts: number) {
  const parts = HISTORY_TIMESTAMP_FORMATTER.formatToParts(new Date(ts * 1000));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const zone = parts.find((part) => part.type === "timeZoneName")?.value ?? "";

  return `${month} ${day} ${hour}:${minute} ${zone}`.trim();
}

function formatTrendAxisTimestamp(ts: number) {
  const parts = TREND_AXIS_TIMESTAMP_FORMATTER.formatToParts(new Date(ts * 1000));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";

  return `${month} ${day} ${hour}:${minute}`.trim();
}

function getValueBounds(rows: PolymarketHistoryRow[]) {
  const values = rows
    .flatMap((row) => [row.finalPricePct, ...row.historyPoints.map((point) => point.pricePct)])
    .filter((value): value is number => value !== null && Number.isFinite(value));

  if (!values.length) {
    return { max: 0, min: 0 };
  }

  return {
    max: Math.max(...values),
    min: Math.min(...values),
  };
}

function getHistoryCellStyle(input: {
  isLeader: boolean;
  max: number;
  min: number;
  value: number | null;
}) {
  if (input.value === null || !Number.isFinite(input.value)) {
    return {
      background:
        "linear-gradient(180deg, rgba(16, 21, 34, 0.98) 0%, rgba(10, 14, 24, 0.98) 100%)",
      borderColor: "rgba(130, 145, 173, 0.14)",
      color: "rgba(185, 195, 214, 0.48)",
    };
  }

  const spread = input.max - input.min;
  const ratio = spread <= 0 ? 1 : (input.value - input.min) / spread;
  const color = getGradientColor(ratio);
  const highlightOpacity = input.isLeader ? 0.24 : 0.08;

  return {
    background: `linear-gradient(180deg, rgba(${color.red}, ${color.green}, ${color.blue}, 0.96) 0%, rgba(${Math.max(
      color.red - 6,
      0
    )}, ${Math.max(color.green - 6, 0)}, ${Math.max(color.blue - 6, 0)}, 0.99) 100%)`,
    borderColor: input.isLeader
      ? "rgba(255, 209, 133, 0.54)"
      : `rgba(255, 255, 255, ${0.08 + ratio * 0.12})`,
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, ${highlightOpacity})`,
    color: ratio >= 0.72 ? "#eef8ec" : "#f2f3fb",
  };
}

function getHistoryValueAtOrBefore(historyPoints: PolymarketHistoryPoint[], ts: number) {
  for (let index = historyPoints.length - 1; index >= 0; index -= 1) {
    if (historyPoints[index].ts <= ts) {
      return historyPoints[index].pricePct;
    }
  }

  return null;
}

function getTimelineColumns(gridEndTs: number | null, window: PolymarketHistoryWindow | null) {
  if (!gridEndTs || !window) {
    return [] as TimelineColumn[];
  }

  const startTs = gridEndTs - window.hours * 60 * 60;
  const columns: TimelineColumn[] = [];

  for (let ts = startTs; ts <= gridEndTs; ts += 60 * 60) {
    columns.push({
      axisLabel: formatTrendAxisTimestamp(ts),
      label: formatHistoryTimestamp(ts),
      ts,
    });
  }

  return columns;
}

function getTweetCountAtTs(points: PolymarketHistoryResponse["tweetTimelinePoints"], ts: number) {
  return points.find((point) => point.ts === ts)?.count ?? 0;
}

function getTimelineLeaders(rows: PolymarketHistoryRow[], columns: TimelineColumn[]) {
  return columns.map((column) => {
    let leader: { bracket: string; value: number } | null = null;

    for (const row of rows) {
      const value = getHistoryValueAtOrBefore(row.historyPoints, column.ts);
      if (value === null) {
        continue;
      }

      if (!leader || value > leader.value) {
        leader = {
          bracket: row.bracket,
          value,
        };
      }
    }

    return leader?.bracket ?? null;
  });
}

function getTrendSeries(rows: PolymarketHistoryRow[], columns: TimelineColumn[]) {
  if (!columns.length) {
    return [] as TrendSeries[];
  }

  const latestTs = columns[columns.length - 1]?.ts ?? null;
  if (!latestTs) {
    return [];
  }

  return rows
    .map((row) => {
      const values = columns.map((column) => getHistoryValueAtOrBefore(row.historyPoints, column.ts));
      return {
        bracket: row.bracket,
        latestValue: getHistoryValueAtOrBefore(row.historyPoints, latestTs),
        values,
      };
    })
    .filter((row) => row.latestValue !== null)
    .sort((left, right) => (right.latestValue ?? 0) - (left.latestValue ?? 0))
    .slice(0, TREND_SERIES_COLORS.length)
    .map((row, index) => ({
      ...row,
      color: TREND_SERIES_COLORS[index] ?? "#9eb7d6",
    }));
}

function getChartMax(maxValue: number) {
  if (maxValue <= 0) return 1;
  return Math.ceil(maxValue * 2) / 2;
}

function getChartTicks(chartMax: number) {
  const tickCount = 5;

  return Array.from({ length: tickCount + 1 }, (_, index) => {
    return chartMax - (chartMax / tickCount) * index;
  });
}

function buildSmoothTrendSegment(points: TrendChartPoint[]) {
  if (!points.length) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  }

  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(
      2
    )} ${points[1].y.toFixed(2)}`;
  }

  const smoothing = 0.16;
  const commands = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const previousPoint = points[index - 1] ?? points[index];
    const currentPoint = points[index];
    const nextPoint = points[index + 1];
    const followingPoint = points[index + 2] ?? nextPoint;
    const controlPoint1X = currentPoint.x + (nextPoint.x - previousPoint.x) * smoothing;
    const controlPoint1Y = currentPoint.y + (nextPoint.y - previousPoint.y) * smoothing;
    const controlPoint2X = nextPoint.x - (followingPoint.x - currentPoint.x) * smoothing;
    const controlPoint2Y = nextPoint.y - (followingPoint.y - currentPoint.y) * smoothing;

    commands.push(
      `C ${controlPoint1X.toFixed(2)} ${controlPoint1Y.toFixed(2)}, ${controlPoint2X.toFixed(
        2
      )} ${controlPoint2Y.toFixed(2)}, ${nextPoint.x.toFixed(2)} ${nextPoint.y.toFixed(2)}`
    );
  }

  return commands.join(" ");
}

function buildTrendPath(input: {
  chartHeight: number;
  chartWidth: number;
  leftPadding: number;
  maxValue: number;
  rightPadding: number;
  topPadding: number;
  values: Array<number | null>;
}) {
  const pointCount = input.values.length;
  if (!pointCount) {
    return "";
  }

  const usableWidth = Math.max(input.chartWidth - input.leftPadding - input.rightPadding, 1);
  const stepX = pointCount === 1 ? 0 : usableWidth / (pointCount - 1);
  const segments: TrendChartPoint[][] = [];
  let currentSegment: TrendChartPoint[] = [];

  input.values.forEach((value, index) => {
    if (value === null) {
      if (currentSegment.length) {
        segments.push(currentSegment);
        currentSegment = [];
      }
      return;
    }

    currentSegment.push({
      x: input.leftPadding + index * stepX,
      y: input.topPadding + input.chartHeight - (value / input.maxValue) * input.chartHeight,
    });
  });

  if (currentSegment.length) {
    segments.push(currentSegment);
  }

  return segments.map((segment) => buildSmoothTrendSegment(segment)).join(" ");
}

function getTrendLabelStep(count: number) {
  if (count <= 6) return 1;
  if (count <= 12) return 2;
  if (count <= 18) return 3;
  return 4;
}

export function MarketPriceHistoryTable({
  data,
  emptyMessage,
  error,
  loading,
}: MarketPriceHistoryTableProps) {
  const [activeView, setActiveView] = useState<HistoryView>("price");
  const [selectedWindowByView, setSelectedWindowByView] = useState<
    Record<HistoryView, PolymarketHistoryWindowId>
  >(VIEW_DEFAULT_WINDOWS);

  useEffect(() => {
    if (!data?.windows.length) {
      return;
    }

    setSelectedWindowByView((current) => {
      let changed = false;
      const next = { ...current };

      (Object.keys(VIEW_DEFAULT_WINDOWS) as HistoryView[]).forEach((view) => {
        if (data.windows.some((window) => window.id === current[view])) {
          return;
        }

        const fallbackWindow =
          data.windows.find((window) => window.id === VIEW_DEFAULT_WINDOWS[view]) ?? data.windows[0];

        if (fallbackWindow && fallbackWindow.id !== current[view]) {
          next[view] = fallbackWindow.id;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [data?.windows]);

  const selectedWindowId = selectedWindowByView[activeView];

  const valueBounds = useMemo(() => getValueBounds(data?.rows ?? []), [data?.rows]);
  const selectedWindow = useMemo(() => {
    if (!data?.windows.length) {
      return null;
    }

    return data.windows.find((window) => window.id === selectedWindowId) ?? data.windows[0];
  }, [data?.windows, selectedWindowId]);
  const orderedWindows = useMemo(() => {
    return [...(data?.windows ?? [])].sort((left, right) => right.hours - left.hours);
  }, [data?.windows]);
  const timelineColumns = useMemo(
    () => getTimelineColumns(data?.timelineEndTs ?? data?.asOfTs ?? null, selectedWindow),
    [data?.asOfTs, data?.timelineEndTs, selectedWindow]
  );
  const timelineLeaders = useMemo(
    () => getTimelineLeaders(data?.rows ?? [], timelineColumns),
    [data?.rows, timelineColumns]
  );
  const trendSeries = useMemo(
    () => getTrendSeries(data?.rows ?? [], timelineColumns),
    [data?.rows, timelineColumns]
  );
  const hasFinalColumn = useMemo(
    () => (data?.rows ?? []).some((row) => row.isResolved && row.finalPricePct !== null),
    [data?.rows]
  );
  const finalLeader = useMemo(() => {
    if (!hasFinalColumn || !data?.rows.length) {
      return null;
    }

    return (
      data.rows.find((row) => row.finalPricePct !== null && row.finalPricePct >= 100)?.bracket ?? null
    );
  }, [data?.rows, hasFinalColumn]);
  const winnerOutsideVisibleRange = useMemo(() => {
    if (!data?.resolvedWinnerBracket) {
      return false;
    }

    return !(data.rows ?? []).some((row) => row.bracket === data.resolvedWinnerBracket);
  }, [data?.resolvedWinnerBracket, data?.rows]);
  const trendTweetCounts = useMemo(
    () => timelineColumns.map((column) => getTweetCountAtTs(data?.tweetTimelinePoints ?? [], column.ts)),
    [data?.tweetTimelinePoints, timelineColumns]
  );
  const trendTweetMax = useMemo(() => {
    return trendTweetCounts.reduce((maxValue, value) => Math.max(maxValue, value), 0);
  }, [trendTweetCounts]);
  const trendTweetChartMax = useMemo(() => getChartMax(trendTweetMax), [trendTweetMax]);
  const trendTweetTicks = useMemo(() => getChartTicks(trendTweetChartMax), [trendTweetChartMax]);
  const trendPriceMax = useMemo(() => {
    const maxValue = trendSeries.reduce<number>((currentMax, series) => {
      const seriesMax = series.values.reduce<number>((maxSeriesValue, value) => {
        return value !== null ? Math.max(maxSeriesValue, value) : maxSeriesValue;
      }, 0);

      return Math.max(currentMax, seriesMax);
    }, 0);

    return getChartMax(maxValue);
  }, [trendSeries]);
  const trendPriceTicks = useMemo(() => getChartTicks(trendPriceMax), [trendPriceMax]);
  const trendLatestLeader = trendSeries[0] ?? null;
  const trendTweetTotal = useMemo(
    () => trendTweetCounts.reduce((total, value) => total + value, 0),
    [trendTweetCounts]
  );
  const trendLabelStep = useMemo(() => getTrendLabelStep(timelineColumns.length), [timelineColumns.length]);
  const trendChartWidth = Math.max(560, timelineColumns.length * 76);
  const trendChartHeight = 320;
  const trendPlotPadding = { bottom: 60, left: 24, right: 24, top: 18 };
  const trendSvgHeight = trendChartHeight + trendPlotPadding.bottom + trendPlotPadding.top;
  const trendInnerWidth = Math.max(
    trendChartWidth - trendPlotPadding.left - trendPlotPadding.right,
    1
  );
  const trendStepX =
    timelineColumns.length <= 1 ? 0 : trendInnerWidth / Math.max(timelineColumns.length - 1, 1);
  const trendBarWidth = Math.max(10, Math.min(24, trendStepX * 0.46));
  const showTrendPointMarkers = timelineColumns.length <= 12;
  const colSpan = 1 + (hasFinalColumn ? 1 : 0) + Math.max(timelineColumns.length, 1);

  return (
    <section className="table-card market-price-history-card">
      <div className="table-header market-price-history-header">
        <div>
          <p className="eyebrow">Polymarket</p>
          <div className="market-price-history-title-row">
            <h2>{activeView === "trend" ? "Trend History" : "Price History"}</h2>
            <div className="market-price-history-view-tabs" role="tablist" aria-label="History views">
              <button
                type="button"
                role="tab"
                aria-selected={activeView === "price"}
                className={`market-price-history-view-tab${
                  activeView === "price" ? " market-price-history-view-tab--active" : ""
                }`}
                onClick={() => setActiveView("price")}
              >
                Price
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeView === "trend"}
                className={`market-price-history-view-tab${
                  activeView === "trend" ? " market-price-history-view-tab--active" : ""
                }`}
                onClick={() => setActiveView("trend")}
              >
                Trend
              </button>
            </div>
          </div>
          <p className="market-price-history-subtitle">
            {data
              ? activeView === "trend"
                ? `Hourly trend view for ${data.eventTitle}. Bars show tweet count and lines show YES-price leaders within ${data.visibleBracketRangeLabel}.`
                : `Hourly YES-price timeline for ${data.eventTitle}. Columns are fixed to an hourly grid and visible brackets are filtered to ${data.visibleBracketRangeLabel}.`
              : "Hourly YES-price timeline for the selected event. Final shows the resolved payout when the market is closed."}
          </p>
          {winnerOutsideVisibleRange ? (
            <p className="market-price-history-warning">
              Resolved winner {data?.resolvedWinnerBracket} is outside the visible {data?.visibleBracketRangeLabel} range.
            </p>
          ) : null}
        </div>

        <div className="market-price-history-controls">
          <div
            className="market-price-history-range-tabs"
            role="tablist"
            aria-label={activeView === "trend" ? "Trend history ranges" : "Price history ranges"}
          >
            {orderedWindows.map((window) => (
              <button
                key={window.id}
                type="button"
                role="tab"
                aria-selected={selectedWindow?.id === window.id}
                className={`market-price-history-range-tab${
                  selectedWindow?.id === window.id ? " market-price-history-range-tab--active" : ""
                }`}
                onClick={() =>
                  setSelectedWindowByView((current) => ({
                    ...current,
                    [activeView]: window.id,
                  }))
                }
              >
                {window.id}
              </button>
            ))}
          </div>
          <p className="market-price-history-meta-value">{data?.asOfLabel ?? "--"}</p>
        </div>
      </div>

      {activeView === "price" ? (
      <div className="table-scroll market-price-history-scroll">
        <table className="heatmap-table market-history-table market-history-table--timeline">
          <thead>
            <tr>
              <th className="market-history-bracket-header" scope="col">
                Bracket
              </th>
              {hasFinalColumn ? (
                <th className="market-history-window-header" scope="col">
                  Final
                </th>
              ) : null}
              {timelineColumns.map((column) => (
                <th key={column.ts} className="market-history-timestamp-header" scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="empty-state" colSpan={colSpan}>
                  Loading price history...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td className="empty-state empty-state--error" colSpan={colSpan}>
                  {error}
                </td>
              </tr>
            ) : data && data.rows.length > 0 && timelineColumns.length > 0 ? (
              data.rows.map((row) => (
                <tr key={row.bracket}>
                  <th className="market-history-bracket-cell" scope="row" title={row.marketSlug}>
                    {row.bracket}
                  </th>
                  {hasFinalColumn ? (
                    <td className="market-history-value-cell">
                      <div
                        className={`market-history-value${
                          row.finalPricePct !== null && row.finalPricePct >= 100
                            ? " market-history-value--leader"
                            : ""
                        }`}
                        style={getHistoryCellStyle({
                          isLeader: row.finalPricePct !== null && row.finalPricePct >= 100,
                          max: valueBounds.max,
                          min: valueBounds.min,
                          value: row.finalPricePct,
                        })}
                      >
                        {formatHistoryValue(row.finalPricePct)}
                      </div>
                    </td>
                  ) : null}
                  {timelineColumns.map((column, index) => {
                    const value = getHistoryValueAtOrBefore(row.historyPoints, column.ts);
                    const isLeader = timelineLeaders[index] === row.bracket;

                    return (
                      <td key={`${row.bracket}-${column.ts}`} className="market-history-value-cell">
                        <div
                          className={`market-history-value${
                            isLeader ? " market-history-value--leader" : ""
                          }`}
                          style={getHistoryCellStyle({
                            isLeader,
                            max: valueBounds.max,
                            min: valueBounds.min,
                            value,
                          })}
                        >
                          {formatHistoryValue(value)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-state" colSpan={colSpan}>
                  {emptyMessage ?? "No historical Polymarket price points were found for this event."}
                </td>
              </tr>
            )}
          </tbody>

          {data && data.rows.length > 0 && timelineColumns.length > 0 ? (
            <tfoot>
              <tr>
                <th className="market-history-footer-label" scope="row">
                  Leader
                </th>
                {hasFinalColumn ? (
                  <td className="market-history-footer-cell">{finalLeader ?? "--"}</td>
                ) : null}
                {timelineLeaders.map((leader, index) => (
                  <td key={`leader-${timelineColumns[index]?.ts ?? index}`} className="market-history-footer-cell">
                    {leader ?? "--"}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      ) : (
        <div className="market-trend-chart-card">
          {loading ? (
            <div className="tweets-empty-state">Loading trend chart...</div>
          ) : error ? (
            <div className="tweets-empty-state tweets-empty-state--error">{error}</div>
          ) : trendSeries.length > 0 && timelineColumns.length > 0 ? (
            <>
              <div className="market-trend-chart-header">
                <div className="market-trend-chart-summary">
                  <div className="market-trend-chart-pill">
                    <span>Range</span>
                    <strong>{selectedWindow?.label ?? "--"}</strong>
                  </div>
                  <div className="market-trend-chart-pill">
                    <span>Tweets</span>
                    <strong>{trendTweetTotal}</strong>
                  </div>
                  <div className="market-trend-chart-pill">
                    <span>Leader</span>
                    <strong>
                      {trendLatestLeader
                        ? `${trendLatestLeader.bracket} ${formatHistoryValue(
                            trendLatestLeader.latestValue
                          )}c`
                        : "--"}
                    </strong>
                  </div>
                </div>
                <p className="market-trend-chart-helper">
                  All times EDT • Grid end: {timelineColumns[timelineColumns.length - 1]?.label ?? "--"}
                </p>
              </div>

              <div className="market-trend-chart-shell">
                <div className="market-trend-chart-axis market-trend-chart-axis--left">
                  {trendTweetTicks.map((tickValue, index) => (
                    <span
                      key={`trend-y-tick-${tickValue.toFixed(2)}`}
                      style={{
                        bottom: `${((trendPlotPadding.bottom +
                          (tickValue / trendTweetChartMax) * trendChartHeight) /
                          trendSvgHeight) *
                          100}%`,
                      }}
                    >
                      {tickValue.toFixed(0)}
                    </span>
                  ))}
                  <strong>Tweets</strong>
                </div>

                <div className="market-trend-chart-scroll">
                  <div className="market-trend-chart-plot" style={{ width: `${trendChartWidth}px` }}>
                    <svg
                      className="market-trend-chart-svg"
                      viewBox={`0 0 ${trendChartWidth} ${trendSvgHeight}`}
                      preserveAspectRatio="none"
                    >
                      {trendTweetTicks.map((tickValue) => {
                        const y =
                          trendPlotPadding.top +
                          trendChartHeight -
                          (tickValue / trendTweetChartMax) * trendChartHeight;

                        return (
                          <line
                            key={`trend-grid-${tickValue.toFixed(2)}`}
                            x1={trendPlotPadding.left}
                            x2={trendChartWidth - trendPlotPadding.right}
                            y1={y}
                            y2={y}
                            stroke="rgba(155, 169, 197, 0.14)"
                            strokeWidth="1"
                          />
                        );
                      })}

                      {timelineColumns.map((column, index) => {
                        const x = trendPlotPadding.left + index * trendStepX;
                        const count = trendTweetCounts[index] ?? 0;
                        const barHeight =
                          trendTweetChartMax > 0 ? (count / trendTweetChartMax) * trendChartHeight : 0;
                        const visibleBarHeight = count > 0 ? Math.max(barHeight, 4) : 0;
                        const labelY = trendPlotPadding.top + trendChartHeight + 24;
                        const shouldShowLabel =
                          index === 0 ||
                          index === timelineColumns.length - 1 ||
                          index % trendLabelStep === 0;

                        return (
                          <g key={column.ts}>
                            {shouldShowLabel ? (
                              <line
                                x1={x}
                                x2={x}
                                y1={trendPlotPadding.top}
                                y2={trendPlotPadding.top + trendChartHeight}
                                stroke="rgba(155, 169, 197, 0.08)"
                                strokeWidth="1"
                                strokeDasharray="3 7"
                              />
                            ) : null}
                            {visibleBarHeight > 0 ? (
                              <rect
                                x={x - trendBarWidth / 2}
                                y={trendPlotPadding.top + trendChartHeight - visibleBarHeight}
                                width={trendBarWidth}
                                height={visibleBarHeight}
                                rx="6"
                                fill="rgba(79, 143, 214, 0.26)"
                                stroke="rgba(97, 169, 255, 0.34)"
                                strokeWidth="1"
                              />
                            ) : null}
                            {shouldShowLabel ? (
                              <text
                                x={x}
                                y={labelY}
                                className="market-trend-chart-label"
                                textAnchor="end"
                                transform={`rotate(-32 ${x} ${labelY})`}
                              >
                                {column.axisLabel}
                              </text>
                            ) : null}
                          </g>
                        );
                      })}

                      {trendSeries.map((series) => {
                        const path = buildTrendPath({
                          chartHeight: trendChartHeight,
                          chartWidth: trendChartWidth,
                          leftPadding: trendPlotPadding.left,
                          maxValue: trendPriceMax,
                          rightPadding: trendPlotPadding.right,
                          topPadding: trendPlotPadding.top,
                          values: series.values,
                        });

                        return (
                          <g key={series.bracket}>
                            <path
                              d={path}
                              fill="none"
                              stroke={series.color}
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            {series.values.map((value, index) => {
                              if (value === null) {
                                return null;
                              }

                              const isLatestPoint = index === series.values.length - 1;
                              if (!showTrendPointMarkers && !isLatestPoint) {
                                return null;
                              }

                              const x = trendPlotPadding.left + index * trendStepX;
                              const y =
                                trendPlotPadding.top +
                                trendChartHeight -
                                (value / trendPriceMax) * trendChartHeight;

                              return (
                                <circle
                                  key={`${series.bracket}-${timelineColumns[index]?.ts ?? index}`}
                                  cx={x}
                                  cy={y}
                                  r={isLatestPoint ? "4.8" : "3.2"}
                                  fill="#0b1019"
                                  stroke={series.color}
                                  strokeWidth={isLatestPoint ? "2.8" : "2"}
                                />
                              );
                            })}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>

                <div className="market-trend-chart-axis market-trend-chart-axis--right">
                  {trendPriceTicks.map((tickValue) => (
                    <span
                      key={`trend-price-tick-${tickValue.toFixed(2)}`}
                      style={{
                        bottom: `${((trendPlotPadding.bottom +
                          (tickValue / trendPriceMax) * trendChartHeight) /
                          trendSvgHeight) *
                          100}%`,
                      }}
                    >
                      {tickValue.toFixed(0)}c
                    </span>
                  ))}
                  <strong>YES Price</strong>
                </div>
              </div>

              <div className="market-trend-legend">
                {trendSeries.map((series) => (
                  <div key={series.bracket} className="market-trend-legend-item">
                    <span
                      className="market-trend-legend-swatch"
                      style={{ backgroundColor: series.color }}
                    />
                    <div className="market-trend-legend-copy">
                      <span className="market-trend-legend-label">{series.bracket}</span>
                      <span className="market-trend-legend-value">
                        {formatHistoryValue(series.latestValue)}c
                      </span>
                    </div>
                  </div>
                ))}
                <div className="market-trend-legend-item market-trend-legend-item--tweets">
                  <span className="market-trend-legend-swatch market-trend-legend-swatch--tweets" />
                  <div className="market-trend-legend-copy">
                    <span className="market-trend-legend-label">Tweets</span>
                    <span className="market-trend-legend-value">{trendTweetMax}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="tweets-empty-state">
              {emptyMessage ?? "Not enough data to render the trend chart for this range."}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

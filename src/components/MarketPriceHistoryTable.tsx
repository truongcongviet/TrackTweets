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

type TimelineColumn = {
  label: string;
  ts: number;
};

const LOW_COLOR = { blue: 39, green: 38, red: 28 };
const MID_COLOR = { blue: 87, green: 73, red: 85 };
const HIGH_COLOR = { blue: 90, green: 139, red: 80 };
const HISTORY_TIMEZONE = "America/New_York";

const HISTORY_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "short",
  timeZone: HISTORY_TIMEZONE,
  timeZoneName: "short",
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

function getLatestHistoryTs(rows: PolymarketHistoryRow[], fallbackTs: number | null) {
  const timestamps = rows
    .flatMap((row) => row.historyPoints.map((point) => point.ts))
    .filter((ts) => Number.isFinite(ts));

  if (!timestamps.length) {
    return fallbackTs;
  }

  return Math.max(...timestamps);
}

function getTimelineColumns(gridEndTs: number | null, window: PolymarketHistoryWindow | null) {
  if (!gridEndTs || !window) {
    return [] as TimelineColumn[];
  }

  const startTs = gridEndTs - window.hours * 60 * 60;
  const columns: TimelineColumn[] = [];

  for (let ts = startTs; ts <= gridEndTs; ts += 60 * 60) {
    columns.push({
      label: formatHistoryTimestamp(ts),
      ts,
    });
  }

  return columns;
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

export function MarketPriceHistoryTable({
  data,
  emptyMessage,
  error,
  loading,
}: MarketPriceHistoryTableProps) {
  const [selectedWindowId, setSelectedWindowId] = useState<PolymarketHistoryWindowId>("1h");

  useEffect(() => {
    if (!data?.windows.length) {
      return;
    }

    if (!data.windows.some((window) => window.id === selectedWindowId)) {
      setSelectedWindowId(data.windows[0].id);
    }
  }, [data?.windows, selectedWindowId]);

  const valueBounds = useMemo(() => getValueBounds(data?.rows ?? []), [data?.rows]);
  const selectedWindow = useMemo(() => {
    if (!data?.windows.length) {
      return null;
    }

    return data.windows.find((window) => window.id === selectedWindowId) ?? data.windows[0];
  }, [data?.windows, selectedWindowId]);
  const timelineEndTs = useMemo(
    () => getLatestHistoryTs(data?.rows ?? [], data?.asOfTs ?? null),
    [data?.asOfTs, data?.rows]
  );
  const timelineColumns = useMemo(
    () => getTimelineColumns(timelineEndTs, selectedWindow),
    [selectedWindow, timelineEndTs]
  );
  const timelineLeaders = useMemo(
    () => getTimelineLeaders(data?.rows ?? [], timelineColumns),
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
  const colSpan = 1 + (hasFinalColumn ? 1 : 0) + Math.max(timelineColumns.length, 1);

  return (
    <section className="table-card market-price-history-card">
      <div className="table-header market-price-history-header">
        <div>
          <p className="eyebrow">Polymarket</p>
          <h2>Price History</h2>
          <p className="market-price-history-subtitle">
            {data
              ? `Hourly YES-price timeline for ${data.eventTitle}. Columns are fixed to an hourly grid and visible brackets are filtered to ${data.visibleBracketRangeLabel}.`
              : "Hourly YES-price timeline for the selected event. Final shows the resolved payout when the market is closed."}
          </p>
          {winnerOutsideVisibleRange ? (
            <p className="market-price-history-warning">
              Resolved winner {data?.resolvedWinnerBracket} is outside the visible {data?.visibleBracketRangeLabel} range.
            </p>
          ) : null}
        </div>

        <div className="market-price-history-controls">
          <div className="market-price-history-range-tabs" role="tablist" aria-label="Price history ranges">
            {(data?.windows ?? []).map((window) => (
              <button
                key={window.id}
                type="button"
                role="tab"
                aria-selected={selectedWindow?.id === window.id}
                className={`market-price-history-range-tab${
                  selectedWindow?.id === window.id ? " market-price-history-range-tab--active" : ""
                }`}
                onClick={() => setSelectedWindowId(window.id)}
              >
                {window.id}
              </button>
            ))}
          </div>
          <p className="market-price-history-meta-value">{data?.asOfLabel ?? "--"}</p>
        </div>
      </div>

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
    </section>
  );
}

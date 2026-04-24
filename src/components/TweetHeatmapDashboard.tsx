"use client";

import { useEffect, useMemo, useState } from "react";
import { HOUR_KEYS } from "@/lib/hourly-aggregation";
import type { HourKey, HourlyHeatmapResponse, TrackingWindow } from "@/lib/types";

const DEFAULT_HANDLE = "elonmusk";
const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
const MARKET_COUNT_REFRESH_MS = 30_000;

type HeatmapApiError = {
  message?: string;
};

type SubmittedRange = {
  handle: string;
  start: string;
  end: string;
  timezone: string;
};

type MarketApiResponse = {
  rangePostCount: number;
};

type XApiError = {
  message?: string;
};

type XTrackerRecentPost = {
  createdAt: string | null;
  id: string;
  text: string;
  url: string | null;
};

type XTrackerPostsResult = {
  handle: string;
  posts: XTrackerRecentPost[];
};

type TrendDirection = "up" | "down" | "flat" | "none";

type HeatmapTrend = {
  delta: number;
  direction: TrendDirection;
  label: string;
  title: string;
};

type HeatmapDayColumn = {
  date: string;
  dayLabel: string;
  total: number;
  trend: HeatmapTrend;
  weekdayLabel: string;
};

type HeatmapHourRow = {
  average: number;
  hour: HourKey;
  values: number[];
};

type HeatmapView = "classic" | "timeline";

const DAY_HEADER_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  timeZone: "UTC",
  weekday: "short",
});
const DATE_KEY_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const HOUR_KEY_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const TWEET_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatLastSync(value: string | null, timezone: string) {
  if (!value) {
    return "Waiting for first sync";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
}

function formatTrackingLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).formatToParts(date);

  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const weekday = parts.find((part) => part.type === "weekday")?.value;

  return [month, day, weekday].filter(Boolean).join(" ");
}

function getDefaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);

  return {
    start: formatDateInput(start),
    end: formatDateInput(end),
  };
}

function getCellStyle(value: number, max: number) {
  if (value <= 0 || max <= 0) {
    return {
      background: "linear-gradient(180deg, #2f496f 0%, #2A4064 100%)",
      color: "rgba(214, 226, 245, 0.26)",
    };
  }

  let color = "#f67e29";

  if (value <= 2) {
    color = "#fdd3b6";
  } else if (value <= 6) {
    color = "#faa569";
  }

  return {
    background: `linear-gradient(180deg, ${color} 0%, ${color} 100%)`,
    color: "#16120d",
  };
}

function getClassicCellStyle(value: number, max: number) {
  if (value <= 0 || max <= 0) {
    return {
      background:
        "linear-gradient(180deg, rgba(49, 72, 112, 0.96) 0%, rgba(41, 62, 97, 0.98) 100%)",
      color: "rgba(202, 215, 240, 0.22)",
    };
  }

  let color = "#f67e29";

  if (value <= 2) {
    color = "#fdd3b6";
  } else if (value <= 6) {
    color = "#faa569";
  }

  return {
    background: `linear-gradient(180deg, ${color} 0%, ${color} 100%)`,
    color: "#16120d",
  };
}

function getInclusiveDayCount(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 0;
  }

  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) {
    return 0;
  }

  return Math.floor(diffMs / 86_400_000) + 1;
}

function formatDayHeader(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const parts = DAY_HEADER_FORMATTER.formatToParts(date);

  return {
    dayLabel: parts.find((part) => part.type === "day")?.value ?? dateKey.slice(-2),
    weekdayLabel: parts.find((part) => part.type === "weekday")?.value ?? dateKey,
  };
}

function formatAverage(value: number) {
  return value.toFixed(1);
}

function formatTweetTime(value: string | null) {
  if (!value) return "Unknown time";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return TWEET_TIME_FORMATTER.format(date);
}

function formatRelativeTime(value: string | null, nowMs: number) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = Math.max(nowMs - date.getTime(), 0);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  return formatTweetTime(value);
}

function getDateKeyFormatter(timezone: string) {
  const existing = DATE_KEY_FORMATTERS.get(timezone);
  if (existing) return existing;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  DATE_KEY_FORMATTERS.set(timezone, formatter);
  return formatter;
}

function getHourKeyFormatter(timezone: string) {
  const existing = HOUR_KEY_FORMATTERS.get(timezone);
  if (existing) return existing;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  });

  HOUR_KEY_FORMATTERS.set(timezone, formatter);
  return formatter;
}

function getCurrentTimeSlot(nowMs: number, timezone: string) {
  const date = new Date(nowMs);
  const dateParts = getDateKeyFormatter(timezone).formatToParts(date);
  const year = dateParts.find((part) => part.type === "year")?.value;
  const month = dateParts.find((part) => part.type === "month")?.value;
  const day = dateParts.find((part) => part.type === "day")?.value;
  const hour = getHourKeyFormatter(timezone).format(date) as HourKey;

  if (!year || !month || !day) {
    return null;
  }

  return {
    date: `${year}-${month}-${day}`,
    hour,
  };
}

function getTrend(currentTotal: number, previousTotal: number | null): HeatmapTrend {
  if (previousTotal === null) {
    return {
      delta: 0,
      direction: "none",
      label: "--",
      title: "No previous day",
    };
  }

  const delta = currentTotal - previousTotal;

  if (delta > 0) {
    return {
      delta,
      direction: "up",
      label: "+",
      title: `Up ${formatCount(delta)} vs previous day`,
    };
  }

  if (delta < 0) {
    return {
      delta,
      direction: "down",
      label: "-",
      title: `Down ${formatCount(Math.abs(delta))} vs previous day`,
    };
  }

  return {
    delta,
    direction: "flat",
    label: "=",
    title: "Flat vs previous day",
  };
}

function matchesTrackingRange(tracking: TrackingWindow, start: string, end: string) {
  return tracking.startDate.slice(0, 10) === start && tracking.endDate.slice(0, 10) === end;
}

function getDefaultTracking(trackings: TrackingWindow[], nowMs: number) {
  const liveTracking =
    trackings.find((tracking) => new Date(tracking.endDate).getTime() >= nowMs) ?? null;

  if (liveTracking) {
    return liveTracking;
  }

  return trackings.at(-1) ?? null;
}

function getTrackingProgress(tracking: TrackingWindow, nowMs: number) {
  const startMs = new Date(tracking.startDate).getTime();
  const endMs = new Date(tracking.endDate).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return null;
  }

  const durationMs = endMs - startMs;
  const elapsedMs = Math.min(Math.max(nowMs - startMs, 0), durationMs);
  const remainingMs = Math.max(endMs - nowMs, 0);
  const percent = (elapsedMs / durationMs) * 100;

  return {
    durationMs,
    elapsedMs,
    percent,
    remainingMs,
    isClosed: nowMs >= endMs,
  };
}

function formatCountdown(value: number) {
  const totalSeconds = Math.max(Math.floor(value / 1000), 0);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return `${days} Days ${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}`;
}

function getTrackingWeekdays(tracking: TrackingWindow) {
  const labels: string[] = [];
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });

  const cursor = new Date(tracking.startDate);
  const end = new Date(tracking.endDate);

  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return labels;
  }

  while (cursor.getTime() <= end.getTime()) {
    labels.push(formatter.format(cursor).toUpperCase());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return labels;
}

export function TweetHeatmapDashboard() {
  const defaultRange = useMemo(() => getDefaultRange(), []);
  const [handle, setHandle] = useState(DEFAULT_HANDLE);
  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [submitted, setSubmitted] = useState<SubmittedRange>({
    handle: DEFAULT_HANDLE,
    start: defaultRange.start,
    end: defaultRange.end,
    timezone: DEFAULT_TIMEZONE,
  });
  const [data, setData] = useState<HourlyHeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [marketCount, setMarketCount] = useState<number | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [activeHeatmapView, setActiveHeatmapView] = useState<HeatmapView>("classic");
  const [recentPosts, setRecentPosts] = useState<XTrackerRecentPost[]>([]);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        start: submitted.start,
        end: submitted.end,
        tz: submitted.timezone,
      });

      try {
        const response = await fetch(
          `/api/xtracker/${encodeURIComponent(submitted.handle)}/hourly?${params.toString()}`,
          {
            signal: controller.signal,
          }
        );

        const payload = (await response.json()) as HourlyHeatmapResponse | HeatmapApiError;

        if (!response.ok) {
          const message =
            "message" in payload && typeof payload.message === "string"
              ? payload.message
              : "Failed to load hourly heatmap data";
          throw new Error(message);
        }

        setData(payload as HourlyHeatmapResponse);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        const message =
          fetchError instanceof Error ? fetchError.message : "Failed to load hourly heatmap data";
        setError(message);
        setData(null);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [submitted]);

  useEffect(() => {
    if (activeHeatmapView !== "classic") {
      return;
    }

    const controller = new AbortController();

    async function loadRecentPosts() {
      setPostsLoading(true);
      setPostsError(null);

      try {
        const params = new URLSearchParams({
          end: submitted.end,
          limit: "8",
          start: submitted.start,
        });
        const response = await fetch(
          `/api/xtracker/${encodeURIComponent(submitted.handle)}/posts?${params.toString()}`,
          {
            signal: controller.signal,
          }
        );

        const payload = (await response.json()) as XTrackerPostsResult | XApiError;

        if (!response.ok) {
          const message =
            "message" in payload && typeof payload.message === "string"
              ? payload.message
              : "Failed to load recent posts";
          throw new Error(message);
        }

        setRecentPosts((payload as XTrackerPostsResult).posts);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        const message =
          fetchError instanceof Error ? fetchError.message : "Failed to load recent posts";
        setPostsError(message);
        setRecentPosts([]);
      } finally {
        if (!controller.signal.aborted) {
          setPostsLoading(false);
        }
      }
    }

    void loadRecentPosts();

    return () => controller.abort();
  }, [activeHeatmapView, submitted.end, submitted.handle, submitted.start]);

  const statusLabel = useMemo(() => {
    if (loading) return "Syncing latest posts from XTracker...";
    if (error) return error;
    if (!data) return "No data";
    return `Loaded ${formatCount(data.grandTotal)} posts across ${data.rows.length} day(s)`;
  }, [data, error, loading]);

  const selectedTracking = useMemo(() => {
    if (!data) return null;
    return data.trackings.find((tracking) => tracking.id === selectedMarketId) ?? null;
  }, [data, selectedMarketId]);

  useEffect(() => {
    if (!data) return;

    setSelectedMarketId((current) => {
      if (current && data.trackings.some((tracking) => tracking.id === current)) {
        return current;
      }

      return getDefaultTracking(data.trackings, Date.now())?.id ?? null;
    });
  }, [data]);

  useEffect(() => {
    if (!data || !selectedTracking) {
      setMarketCount(null);
      setMarketLoading(false);
      return;
    }

    const controller = new AbortController();
    const currentTracking = selectedTracking;
    const currentHandle = data.handle;

    async function loadMarketCount() {
      setMarketLoading(true);

      const params = new URLSearchParams({
        startAt: currentTracking.startDate,
        endAt: currentTracking.endDate,
      });

      try {
        const response = await fetch(
          `/api/xtracker/${encodeURIComponent(currentHandle)}/market?${params.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const payload = (await response.json()) as MarketApiResponse | HeatmapApiError;

        if (!response.ok) {
          const message =
            "message" in payload && typeof payload.message === "string"
              ? payload.message
              : "Failed to load market count";
          throw new Error(message);
        }

        setMarketCount((payload as MarketApiResponse).rangePostCount);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setMarketCount(null);
      } finally {
        if (!controller.signal.aborted) {
          setMarketLoading(false);
        }
      }
    }

    void loadMarketCount();
    const intervalId = window.setInterval(() => {
      void loadMarketCount();
    }, MARKET_COUNT_REFRESH_MS);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [data, selectedTracking]);

  const trackingProgress = useMemo(() => {
    if (!selectedTracking) return null;
    return getTrackingProgress(selectedTracking, nowMs);
  }, [nowMs, selectedTracking]);

  const projectedPace = useMemo(() => {
    if (marketCount === null) return 0;
    if (!trackingProgress || trackingProgress.percent <= 0 || trackingProgress.isClosed) {
      return marketCount;
    }

    return Math.round(marketCount / (trackingProgress.percent / 100));
  }, [marketCount, trackingProgress]);

  const trackingWeekdays = useMemo(() => {
    if (!selectedTracking) return [];
    return getTrackingWeekdays(selectedTracking);
  }, [selectedTracking]);

  const chronologicalRows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((left, right) => left.date.localeCompare(right.date));
  }, [data]);

  const dayColumns = useMemo<HeatmapDayColumn[]>(() => {
    return chronologicalRows.map((row, index) => {
      const previousTotal = index > 0 ? chronologicalRows[index - 1].total : null;
      const { dayLabel, weekdayLabel } = formatDayHeader(row.date);

      return {
        date: row.date,
        dayLabel,
        total: row.total,
        trend: getTrend(row.total, previousTotal),
        weekdayLabel,
      };
    });
  }, [chronologicalRows]);

  const hourRows = useMemo<HeatmapHourRow[]>(() => {
    return HOUR_KEYS.map((hour) => {
      const values = chronologicalRows.map((row) => row.hours[hour]);
      const sum = values.reduce((accumulator, value) => accumulator + value, 0);

      return {
        average: values.length > 0 ? sum / values.length : 0,
        hour,
        values,
      };
    });
  }, [chronologicalRows]);

  const averageDailyTotal = useMemo(() => {
    if (!dayColumns.length) return 0;
    const total = dayColumns.reduce((accumulator, column) => accumulator + column.total, 0);
    return total / dayColumns.length;
  }, [dayColumns]);

  const tableColumnCount = useMemo(() => {
    const selectedRangeDays = getInclusiveDayCount(submitted.start, submitted.end);
    return Math.max(dayColumns.length, selectedRangeDays, 1) + 2;
  }, [dayColumns.length, submitted.end, submitted.start]);

  const currentTimeSlot = useMemo(() => {
    return getCurrentTimeSlot(nowMs, submitted.timezone);
  }, [nowMs, submitted.timezone]);

  const classicTableColumnCount = HOUR_KEYS.length + 2;
  const activeTableColumnCount =
    activeHeatmapView === "classic" ? classicTableColumnCount : tableColumnCount;

  return (
    <main className="page-shell">
      <section className="overview-stack">
        <section className="market-card">
          <div className="market-tabs">
            {data?.trackings.length ? (
              data.trackings.map((tracking) => {
                const isActive = selectedTracking?.id === tracking.id;

                return (
                  <button
                    key={tracking.id}
                    type="button"
                    className={`market-tab${isActive ? " market-tab--active" : ""}`}
                    onClick={() => {
                      setSelectedMarketId(tracking.id);
                    }}
                  >
                    {formatTrackingLabel(tracking.endDate)}
                  </button>
                );
              })
            ) : (
              <div className="market-tab market-tab--placeholder">No tracking windows</div>
            )}
          </div>

          {selectedTracking ? (
            <div className="market-body">
              <div className="market-body-header">
                <div>
                  <p className="market-title">Tracking Window</p>
                  <p className="market-subtitle">{selectedTracking.title}</p>
                </div>
                <p className="market-sync">Last sync: {data ? formatLastSync(data.lastSync, submitted.timezone) : "--"}</p>
              </div>

              <div className="market-metrics">
                <div className="market-metric-block">
                  <p className="market-metric-label">Tweet Count</p>
                  <p className="market-metric-value">
                    {marketLoading && marketCount === null ? "--" : marketCount !== null ? formatCount(marketCount) : "--"}
                  </p>
                </div>
                <div className="market-metric-block market-metric-block--right">
                  <p className="market-metric-label">Time Left</p>
                  <p className="market-metric-value market-metric-value--mono">
                    {trackingProgress
                      ? trackingProgress.isClosed
                        ? "Closed"
                        : formatCountdown(trackingProgress.remainingMs)
                      : "--"}
                  </p>
                </div>
              </div>

              <div className="market-progress-wrap">
                <div className="market-progress-bar">
                  <div
                    className="market-progress-fill"
                    style={{ width: `${trackingProgress ? trackingProgress.percent.toFixed(1) : 0}%` }}
                  />

                  <div className="market-progress-meta">
                    <span className="market-progress-percent">
                      {trackingProgress ? `${trackingProgress.percent.toFixed(1)}%` : "--"}
                    </span>
                    <span className="market-progress-pace">
                      Pace: {marketCount !== null ? formatCount(projectedPace) : "--"}
                    </span>
                  </div>
                </div>

                <div className="market-days">
                  {trackingWeekdays.map((label, index) => (
                    <span key={`${label}-${index}`}>{label}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="market-empty">
              {loading ? "Loading tracking windows..." : "Select a tracked date window to inspect pace and countdown."}
            </div>
          )}
        </section>
      </section>

      <section className="table-card">
        <div className="table-header">
          <div>
            <p className="eyebrow">Tweets split into hours</p>
            <h2>Local time heatmap</h2>
            <div className="heatmap-view-tabs" role="tablist" aria-label="Heatmap views">
              <button
                type="button"
                role="tab"
                aria-selected={activeHeatmapView === "classic"}
                className={`heatmap-view-tab${activeHeatmapView === "classic" ? " heatmap-view-tab--active" : ""}`}
                onClick={() => setActiveHeatmapView("classic")}
              >
                Classic Heatmap
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeHeatmapView === "timeline"}
                className={`heatmap-view-tab${activeHeatmapView === "timeline" ? " heatmap-view-tab--active" : ""}`}
                onClick={() => setActiveHeatmapView("timeline")}
              >
                30-Day Heatmap
              </button>
            </div>
          </div>
          <div className="legend">
            <span>Low</span>
            <div className="legend-bar" />
            <span>High</span>
          </div>
        </div>

        <div className={`table-scroll${activeHeatmapView === "classic" ? " table-scroll--classic" : ""}`}>
          {activeHeatmapView === "classic" ? (
            <div className="classic-layout">
              <div className="classic-heatmap-pane">
                <table className="heatmap-table heatmap-table--classic">
                  <thead>
                    <tr>
                      <th className="classic-date-header">Date</th>
                      {HOUR_KEYS.map((hour) => (
                        <th key={hour} className="classic-hour-header">
                          {hour}:00
                        </th>
                      ))}
                      <th className="classic-total-header">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td className="empty-state" colSpan={activeTableColumnCount}>
                          Loading data...
                        </td>
                      </tr>
                    ) : error ? (
                      <tr>
                        <td className="empty-state empty-state--error" colSpan={activeTableColumnCount}>
                          {error}
                        </td>
                      </tr>
                    ) : data && data.rows.length > 0 ? (
                      data.rows.map((row) => (
                        <tr key={row.date}>
                          <th scope="row" className="classic-date-cell">
                            {row.date.slice(5)}
                          </th>
                          {HOUR_KEYS.map((hour) => {
                            const value = row.hours[hour];
                            const isCurrentSlot =
                              currentTimeSlot?.date === row.date && currentTimeSlot.hour === hour;

                            return (
                              <td key={`${row.date}-${hour}`}>
                                <div
                                  className={`heatmap-cell heatmap-cell--classic${isCurrentSlot ? " heatmap-cell--active heatmap-cell--active-classic" : ""}`}
                                  style={getClassicCellStyle(value, data.maxHourlyCount)}
                                  title={isCurrentSlot ? "Current time slot" : undefined}
                                >
                                  {value > 0 ? value : ""}
                                </div>
                              </td>
                            );
                          })}
                          <td className="classic-total-cell">{formatCount(row.total)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="empty-state" colSpan={activeTableColumnCount}>
                          No posts found for the selected range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <aside className="tweets-panel">
                <div className="tweets-panel-header">
                  <div>
                    <p className="eyebrow">XTracker</p>
                    <h3>Recent posts from @{submitted.handle}</h3>
                  </div>
                  <p className="tweets-panel-helper">Range matches current heatmap</p>
                </div>

                <div className="tweets-panel-body">
                  {postsLoading ? (
                    <div className="tweets-empty-state">Loading recent posts...</div>
                  ) : postsError ? (
                    <div className="tweets-empty-state tweets-empty-state--error">{postsError}</div>
                  ) : recentPosts.length > 0 ? (
                    <div className="tweets-list">
                      {recentPosts.map((post) => (
                        <article key={post.id} className="tweet-card">
                          <div className="tweet-card-author">
                            {data?.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                alt={data?.name ? `${data.name} avatar` : `${submitted.handle} avatar`}
                                className="tweet-card-avatar"
                                src={data.avatarUrl}
                              />
                            ) : (
                              <div className="tweet-card-avatar tweet-card-avatar--placeholder">
                                {(data?.name ?? submitted.handle).slice(0, 1).toUpperCase()}
                              </div>
                            )}

                            <div className="tweet-card-author-copy">
                              <div className="tweet-card-author-line">
                                <span className="tweet-card-author-name">
                                  {data?.name ?? submitted.handle}
                                </span>
                                <span className="tweet-card-author-handle">@{submitted.handle}</span>
                                <span className="tweet-card-author-time">
                                  {formatRelativeTime(post.createdAt, nowMs)}
                                </span>
                              </div>
                              <div className="tweet-card-meta">
                                <span>{formatTweetTime(post.createdAt)}</span>
                                {post.url ? (
                                  <a href={post.url} target="_blank" rel="noreferrer">
                                    Open
                                  </a>
                                ) : (
                                  <span>XTracker</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="tweet-card-bubble">
                            <p className="tweet-card-text">{post.text}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="tweets-empty-state">No posts found for this range.</div>
                  )}
                </div>
              </aside>
            </div>
          ) : (
            <table className="heatmap-table heatmap-table--timeline">
              <thead>
                <tr>
                  <th className="heatmap-corner-cell">Hour</th>
                  {dayColumns.map((column) => (
                    <th key={column.date} className="day-header-cell">
                      <span className="day-header-weekday">{column.weekdayLabel}</span>
                      <span className="day-header-date">{column.dayLabel}</span>
                    </th>
                  ))}
                  <th className="avg-header-cell">AVG</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="empty-state" colSpan={activeTableColumnCount}>
                      Loading data...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td className="empty-state empty-state--error" colSpan={activeTableColumnCount}>
                      {error}
                    </td>
                  </tr>
                ) : data && dayColumns.length > 0 ? (
                  hourRows.map((row) => (
                    <tr key={row.hour}>
                      <th scope="row" className="heatmap-row-label">
                        {row.hour}:00
                      </th>
                      {row.values.map((value, index) => {
                        const date = dayColumns[index]?.date ?? `${row.hour}-${index}`;
                        const isCurrentSlot =
                          currentTimeSlot?.date === date && currentTimeSlot.hour === row.hour;

                        return (
                          <td key={`${date}-${row.hour}`}>
                            <div
                              className={`heatmap-cell heatmap-cell--timeline${isCurrentSlot ? " heatmap-cell--active heatmap-cell--active-timeline" : ""}`}
                              style={getCellStyle(value, data.maxHourlyCount)}
                              title={isCurrentSlot ? "Current time slot" : undefined}
                            >
                              {value}
                            </div>
                          </td>
                        );
                      })}
                      <td className="avg-cell">{formatAverage(row.average)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-state" colSpan={activeTableColumnCount}>
                      No posts found for the selected range.
                    </td>
                  </tr>
                )}
              </tbody>
              {!loading && !error && data && dayColumns.length > 0 ? (
                <tfoot>
                  <tr>
                    <th scope="row" className="summary-label-cell">
                      Total
                    </th>
                    {dayColumns.map((column) => (
                      <td key={`${column.date}-total`} className="summary-cell">
                        {formatCount(column.total)}
                      </td>
                    ))}
                    <td className="summary-cell summary-cell--avg">
                      {formatAverage(averageDailyTotal)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="summary-label-cell">
                      Trend
                    </th>
                    {dayColumns.map((column) => (
                      <td
                        key={`${column.date}-trend`}
                        className={`trend-cell trend-cell--${column.trend.direction}`}
                        title={column.trend.title}
                      >
                        {column.trend.label}
                      </td>
                    ))}
                    <td className="summary-cell summary-cell--muted">--</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          )}
        </div>
      </section>
    </main>
  );
}

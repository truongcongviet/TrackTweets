"use client";

import { useEffect, useMemo, useState } from "react";
import { HOUR_KEYS } from "@/lib/hourly-aggregation";
import type { HourlyHeatmapResponse, TrackingWindow } from "@/lib/types";

const DEFAULT_HANDLE = "elonmusk";
const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
const TRACKING_TAB_COUNT = 3;

type HeatmapApiError = {
  message?: string;
};

type SubmittedRange = {
  handle: string;
  start: string;
  end: string;
  timezone: string;
  startAt: string | null;
  endAt: string | null;
};

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
  start.setUTCDate(start.getUTCDate() - 30);

  return {
    start: formatDateInput(start),
    end: formatDateInput(end),
  };
}

function getCellStyle(value: number, max: number) {
  if (value <= 0 || max <= 0) {
    return {
      background:
        "linear-gradient(180deg, rgba(17,32,56,0.88) 0%, rgba(12,24,44,0.92) 100%)",
      color: "rgba(138, 163, 196, 0.72)",
    };
  }

  const intensity = value / max;
  const alpha = 0.32 + intensity * 0.6;
  const color = `rgba(255, 150, 70, ${alpha})`;

  return {
    background: `linear-gradient(180deg, ${color} 0%, rgba(255, 123, 32, ${Math.min(
      0.95,
      alpha + 0.08
    )}) 100%)`,
    color: intensity > 0.45 ? "#14233b" : "#fff3df",
  };
}

function matchesTrackingRange(tracking: TrackingWindow, start: string, end: string) {
  return tracking.startDate.slice(0, 10) === start && tracking.endDate.slice(0, 10) === end;
}

function matchesTrackingExactRange(tracking: TrackingWindow, startAt: string | null, endAt: string | null) {
  return tracking.startDate === startAt && tracking.endDate === endAt;
}

function findMatchingTracking(trackings: TrackingWindow[], input: {
  start: string;
  end: string;
  startAt?: string | null;
  endAt?: string | null;
}) {
  if (input.startAt && input.endAt) {
    const exactMatch = trackings.find((tracking) =>
      matchesTrackingExactRange(tracking, input.startAt ?? null, input.endAt ?? null)
    );

    if (exactMatch) {
      return exactMatch;
    }
  }

  return trackings.find((tracking) => matchesTrackingRange(tracking, input.start, input.end)) ?? null;
}

function getDefaultTracking(trackings: TrackingWindow[], nowMs: number) {
  const liveTracking =
    trackings.find((tracking) => new Date(tracking.endDate).getTime() >= nowMs) ?? null;

  if (liveTracking) {
    return liveTracking;
  }

  return trackings.at(-1) ?? null;
}

function getTrackingAnchorIndex(trackings: TrackingWindow[], selectedTracking: TrackingWindow | null, nowMs: number) {
  if (selectedTracking) {
    const selectedIndex = trackings.findIndex((tracking) => tracking.id === selectedTracking.id);
    if (selectedIndex >= 0) {
      return selectedIndex;
    }
  }

  const liveIndex = trackings.findIndex((tracking) => new Date(tracking.endDate).getTime() >= nowMs);
  if (liveIndex >= 0) {
    return liveIndex;
  }

  return Math.max(trackings.length - 1, 0);
}

function getVisibleTrackings(trackings: TrackingWindow[], selectedTracking: TrackingWindow | null, nowMs: number) {
  if (trackings.length <= TRACKING_TAB_COUNT) {
    return trackings;
  }

  const anchorIndex = getTrackingAnchorIndex(trackings, selectedTracking, nowMs);
  const maxStart = Math.max(trackings.length - TRACKING_TAB_COUNT, 0);
  const sliceStart = Math.min(anchorIndex, maxStart);
  return trackings.slice(sliceStart, sliceStart + TRACKING_TAB_COUNT);
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
    startAt: null,
    endAt: null,
  });
  const [data, setData] = useState<HourlyHeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

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

      if (submitted.startAt && submitted.endAt) {
        params.set("startAt", submitted.startAt);
        params.set("endAt", submitted.endAt);
      }

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

  const statusLabel = useMemo(() => {
    if (loading) return "Syncing latest posts from XTracker...";
    if (error) return error;
    if (!data) return "No data";
    return `Loaded ${formatCount(data.grandTotal)} posts across ${data.rows.length} day(s)`;
  }, [data, error, loading]);

  const selectedTracking = useMemo(() => {
    if (!data) return null;
    return (
      findMatchingTracking(data.trackings, {
        start: submitted.start,
        end: submitted.end,
        startAt: submitted.startAt,
        endAt: submitted.endAt,
      }) ?? getDefaultTracking(data.trackings, nowMs)
    );
  }, [data, nowMs, submitted.end, submitted.endAt, submitted.start, submitted.startAt]);

  const visibleTrackings = useMemo(() => {
    return getVisibleTrackings(data?.trackings ?? [], selectedTracking, nowMs);
  }, [data, nowMs, selectedTracking]);

  const trackingProgress = useMemo(() => {
    if (!selectedTracking) return null;
    return getTrackingProgress(selectedTracking, nowMs);
  }, [nowMs, selectedTracking]);

  const projectedPace = useMemo(() => {
    if (!data) return 0;
    if (!trackingProgress || trackingProgress.percent <= 0 || trackingProgress.isClosed) {
      return data.rangePostCount;
    }

    return Math.round(data.rangePostCount / (trackingProgress.percent / 100));
  }, [data, trackingProgress]);

  const trackingWeekdays = useMemo(() => {
    if (!selectedTracking) return [];
    return getTrackingWeekdays(selectedTracking);
  }, [selectedTracking]);

  return (
    <main className="page-shell">
      <section className="overview-stack">
        <div className="overview-grid">
          <article className="overview-card">
            <p className="overview-label">Total Posts</p>
            <p className="overview-value">{data ? formatCount(data.allTimePostCount) : "--"}</p>
            <p className="overview-helper">Total tweets</p>
          </article>
          <article className="overview-card">
            <p className="overview-label">Original Tweets</p>
            <p className="overview-value">{data ? formatCount(data.allTimeOriginalCount) : "--"}</p>
            <p className="overview-helper">Non-retweets</p>
          </article>
          <article className="overview-card">
            <p className="overview-label">Retweets</p>
            <p className="overview-value">{data ? formatCount(data.allTimeRetweetCount) : "--"}</p>
            <p className="overview-helper">Shared content</p>
          </article>
          <article className="overview-card">
            <p className="overview-label">Avg Length</p>
            <p className="overview-value">{data ? formatCount(data.allTimeAverageLength) : "--"}</p>
            <p className="overview-helper">Characters per tweet</p>
          </article>
        </div>

        <section className="market-card">
          <div className="market-tabs">
            {visibleTrackings.length > 0 ? (
              visibleTrackings.map((tracking) => {
                const isActive = selectedTracking?.id === tracking.id;

                return (
                  <button
                    key={tracking.id}
                    type="button"
                    className={`market-tab${isActive ? " market-tab--active" : ""}`}
                    onClick={() => {
                      setSubmitted({
                        handle: submitted.handle,
                        start: submitted.start,
                        end: submitted.end,
                        timezone: submitted.timezone,
                        startAt: tracking.startDate,
                        endAt: tracking.endDate,
                      });
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
                  <p className="market-metric-value">{data ? formatCount(data.rangePostCount) : "--"}</p>
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
                    <span className="market-progress-pace">Pace: {data ? formatCount(projectedPace) : "--"}</span>
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

      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">TrackTweet</p>
          <h1>{data?.name ?? "Elon Musk"} hourly post tracker</h1>
          <p className="hero-description">
            Fetch raw posts from Polymarket XTracker, derive overview metrics from the full history,
            then render a local-time heatmap for the currently selected market window.
          </p>
          <p className="hero-status">{statusLabel}</p>
        </div>

        <form
          className="control-panel"
          onSubmit={(event) => {
            event.preventDefault();
            const nextHandle = handle.trim().replace(/^@+/, "") || DEFAULT_HANDLE;

            setSubmitted({
              handle: nextHandle,
              start,
              end,
              timezone,
              startAt: nextHandle === submitted.handle ? submitted.startAt : null,
              endAt: nextHandle === submitted.handle ? submitted.endAt : null,
            });
          }}
        >
          <label>
            <span>Handle</span>
            <input value={handle} onChange={(event) => setHandle(event.target.value)} />
          </label>

          <label>
            <span>Start</span>
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>

          <label>
            <span>End</span>
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>

          <label>
            <span>Timezone</span>
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>

          <button type="submit">Refresh heatmap</button>
        </form>
      </section>

      <section className="table-card">
        <div className="table-header">
          <div>
            <p className="eyebrow">Tweets split into hours</p>
            <h2>Local time heatmap</h2>
          </div>
          <div className="legend">
            <span>Low</span>
            <div className="legend-bar" />
            <span>High</span>
          </div>
        </div>

        <div className="table-scroll">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th>Date</th>
                {HOUR_KEYS.map((hour) => (
                  <th key={hour}>{hour}:00</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="empty-state" colSpan={26}>
                    Loading data...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td className="empty-state empty-state--error" colSpan={26}>
                    {error}
                  </td>
                </tr>
              ) : data && data.rows.length > 0 ? (
                data.rows.map((row) => (
                  <tr key={row.date}>
                    <td className="date-cell">{row.date.slice(5)}</td>
                    {HOUR_KEYS.map((hour) => {
                      const value = row.hours[hour];
                      return (
                        <td key={`${row.date}-${hour}`}>
                          <div className="heatmap-cell" style={getCellStyle(value, data.maxHourlyCount)}>
                            {value > 0 ? value : ""}
                          </div>
                        </td>
                      );
                    })}
                    <td className="total-cell">{row.total}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="empty-state" colSpan={26}>
                    No posts found for the selected range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

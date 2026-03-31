"use client";

import { useEffect, useMemo, useState } from "react";
import { HOUR_KEYS } from "@/lib/hourly-aggregation";
import type { HourlyHeatmapResponse } from "@/lib/types";

const DEFAULT_HANDLE = "elonmusk";

type HeatmapApiError = {
  message?: string;
};

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
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

export function TweetHeatmapDashboard() {
  const defaultRange = useMemo(() => getDefaultRange(), []);
  const [handle, setHandle] = useState(DEFAULT_HANDLE);
  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);
  const [timezone, setTimezone] = useState("Asia/Ho_Chi_Minh");
  const [submitted, setSubmitted] = useState({
    handle: DEFAULT_HANDLE,
    start: defaultRange.start,
    end: defaultRange.end,
    timezone: "Asia/Ho_Chi_Minh",
  });
  const [data, setData] = useState<HourlyHeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const statusLabel = useMemo(() => {
    if (loading) return "Syncing latest posts from XTracker...";
    if (error) return error;
    if (!data) return "No data";
    return `Loaded ${data.grandTotal} posts across ${data.rows.length} day(s)`;
  }, [data, error, loading]);

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">TrackTweet</p>
          <h1>Elon Musk hourly post tracker</h1>
          <p className="hero-description">
            Fetch raw posts from Polymarket XTracker, group them by local day and hour, then render
            a heatmap close to the dashboard style you shared.
          </p>
        </div>

        <form
          className="control-panel"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted({
              handle: handle.trim().replace(/^@+/, "") || DEFAULT_HANDLE,
              start,
              end,
              timezone,
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

      <section className="summary-grid">
        <article className="metric-card">
          <p className="metric-label">Source</p>
          <p className="metric-value">XTracker</p>
          <p className="metric-helper">Polymarket-compatible raw posts</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Handle</p>
          <p className="metric-value">@{submitted.handle}</p>
          <p className="metric-helper">{submitted.start} to {submitted.end}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Timezone</p>
          <p className="metric-value">{submitted.timezone}</p>
          <p className="metric-helper">Used for day and hour bucketing</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">Status</p>
          <p className="metric-value metric-value--small">{statusLabel}</p>
          <p className="metric-helper">API: /api/xtracker/[handle]/hourly</p>
        </article>
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

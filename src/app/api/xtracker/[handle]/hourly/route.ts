import { NextRequest, NextResponse } from "next/server";
import { aggregatePostsByHour } from "@/lib/hourly-aggregation";
import { fetchXTrackerLifetimeStats, fetchXTrackerPosts, fetchXTrackerUserSummary } from "@/lib/xtracker";

function isValidIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isValidIsoDateTime(value: string | null) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function sanitizeHandle(rawHandle: string) {
  return rawHandle.replace(/^@+/, "").trim().toLowerCase();
}

function matchesTrackingRange(
  tracking: { startDate: string; endDate: string },
  start: string,
  end: string
) {
  return tracking.startDate.slice(0, 10) === start && tracking.endDate.slice(0, 10) === end;
}

function getDefaultTracking<T extends { startDate: string; endDate: string }>(trackings: T[]) {
  const now = Date.now();
  const liveTracking = trackings.find((tracking) => new Date(tracking.endDate).getTime() >= now);

  if (liveTracking) {
    return liveTracking;
  }

  return trackings.at(-1) ?? null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ handle: string }> }
) {
  const { handle: rawHandle } = await context.params;
  const handle = sanitizeHandle(rawHandle);
  const { searchParams } = request.nextUrl;
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const startAt = searchParams.get("startAt");
  const endAt = searchParams.get("endAt");
  const timezone = searchParams.get("tz") ?? "Asia/Ho_Chi_Minh";

  if (!handle) {
    return NextResponse.json({ message: "Missing handle" }, { status: 400 });
  }

  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return NextResponse.json(
      { message: "Query params start and end must use YYYY-MM-DD format" },
      { status: 400 }
    );
  }

  const safeStart = start as string;
  const safeEnd = end as string;
  const hasProvidedExactWindow = startAt !== null || endAt !== null;

  if (hasProvidedExactWindow && (!isValidIsoDateTime(startAt) || !isValidIsoDateTime(endAt))) {
    return NextResponse.json(
      { message: "Query params startAt and endAt must be valid ISO datetimes" },
      { status: 400 }
    );
  }

  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return NextResponse.json({ message: "Invalid timezone" }, { status: 400 });
  }

  try {
    const userSummary = await fetchXTrackerUserSummary(handle);
    const matchingTracking =
      userSummary.trackings.find((tracking) => matchesTrackingRange(tracking, safeStart, safeEnd)) ?? null;
    const defaultTracking = getDefaultTracking(userSummary.trackings);
    const resolvedStartAt = startAt ?? matchingTracking?.startDate ?? defaultTracking?.startDate ?? null;
    const resolvedEndAt = endAt ?? matchingTracking?.endDate ?? defaultTracking?.endDate ?? null;
    const hasExactWindow = resolvedStartAt !== null && resolvedEndAt !== null;
    const [localPostsResult, exactPostsResult, lifetimeStats] = await Promise.all([
      fetchXTrackerPosts({
        handle,
        start: safeStart,
        end: safeEnd,
      }),
      hasExactWindow
        ? fetchXTrackerPosts({
            handle,
            start: safeStart,
            end: safeEnd,
            startAt: resolvedStartAt,
            endAt: resolvedEndAt,
          })
        : Promise.resolve(null),
      fetchXTrackerLifetimeStats({ handle, lastSync: userSummary.lastSync }),
    ]);

    const heatmap = aggregatePostsByHour({
      handle,
      start: safeStart,
      end: safeEnd,
      timezone,
      timestamps: localPostsResult.timestamps,
    });

    const payload = {
      ...heatmap,
      name: userSummary.name,
      avatarUrl: userSummary.avatarUrl,
      lastSync: userSummary.lastSync,
      allTimePostCount: userSummary.allTimePostCount,
      allTimeOriginalCount: lifetimeStats.originalPostCount,
      allTimeRetweetCount: lifetimeStats.retweetCount,
      allTimeAverageLength: lifetimeStats.averageLength,
      rangePostCount: exactPostsResult?.rawCount ?? heatmap.grandTotal,
      trackings: userSummary.trackings,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

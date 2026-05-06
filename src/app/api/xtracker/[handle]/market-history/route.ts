import { NextRequest, NextResponse } from "next/server";
import { fetchPolymarketBracketHistory } from "@/lib/polymarket";
import { fetchXTrackerPosts } from "@/lib/xtracker";

const MAX_TWEET_TIMELINE_HOURS = 24;

function sanitizeHandle(rawHandle: string) {
  return rawHandle.replace(/^@+/, "").trim().toLowerCase();
}

function isValidIsoDateTime(value: string | null) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function buildTweetTimelinePoints(input: {
  startAt: string;
  timestamps: string[];
  timelineEndTs: number;
}) {
  const requestedStartTs = Math.floor(Date.parse(input.startAt) / 1000);
  const timelineStartTs = Math.max(
    requestedStartTs,
    input.timelineEndTs - MAX_TWEET_TIMELINE_HOURS * 60 * 60
  );

  const points = [];

  for (let ts = timelineStartTs; ts <= input.timelineEndTs; ts += 60 * 60) {
    const bucketStartTs = ts - 60 * 60;
    const count = input.timestamps.reduce((total, timestamp) => {
      const postTs = Math.floor(Date.parse(timestamp) / 1000);

      if (!Number.isFinite(postTs)) {
        return total;
      }

      return postTs > bucketStartTs && postTs <= ts ? total + 1 : total;
    }, 0);

    points.push({
      count,
      ts,
    });
  }

  return points;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ handle: string }> }
) {
  const { handle: rawHandle } = await context.params;
  const handle = sanitizeHandle(rawHandle);
  const { searchParams } = request.nextUrl;
  const eventSlug = searchParams.get("eventSlug");
  const endAt = searchParams.get("endAt");
  const startAt = searchParams.get("startAt");

  if (!handle) {
    return NextResponse.json({ message: "Missing handle" }, { status: 400 });
  }

  if (!eventSlug) {
    return NextResponse.json({ message: "Missing eventSlug" }, { status: 400 });
  }

  if (!isValidIsoDateTime(endAt)) {
    return NextResponse.json({ message: "Invalid endAt datetime" }, { status: 400 });
  }

  if (!isValidIsoDateTime(startAt)) {
    return NextResponse.json({ message: "Invalid startAt datetime" }, { status: 400 });
  }

  try {
    const payload = await fetchPolymarketBracketHistory({
      endAt: endAt as string,
      eventSlug,
    });
    const timelineWindowStart = new Date(
      Math.max(
        Date.parse(startAt as string),
        payload.timelineEndTs * 1000 - MAX_TWEET_TIMELINE_HOURS * 60 * 60 * 1000
      )
    ).toISOString();
    const timelineWindowEnd = new Date((payload.timelineEndTs + 1) * 1000).toISOString();
    const posts = await fetchXTrackerPosts({
      end: timelineWindowEnd.slice(0, 10),
      endAt: timelineWindowEnd,
      handle,
      start: timelineWindowStart.slice(0, 10),
      startAt: timelineWindowStart,
    });
    payload.tweetTimelinePoints = buildTweetTimelinePoints({
      startAt: startAt as string,
      timelineEndTs: payload.timelineEndTs,
      timestamps: posts.timestamps,
    });

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

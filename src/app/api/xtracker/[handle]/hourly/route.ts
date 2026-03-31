import { NextRequest, NextResponse } from "next/server";
import { aggregatePostsByHour } from "@/lib/hourly-aggregation";
import { fetchXTrackerPosts } from "@/lib/xtracker";

function isValidIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function sanitizeHandle(rawHandle: string) {
  return rawHandle.replace(/^@+/, "").trim().toLowerCase();
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

  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return NextResponse.json({ message: "Invalid timezone" }, { status: 400 });
  }

  try {
    const timestamps = await fetchXTrackerPosts({ handle, start: safeStart, end: safeEnd });
    const payload = aggregatePostsByHour({
      handle,
      start: safeStart,
      end: safeEnd,
      timezone,
      timestamps,
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

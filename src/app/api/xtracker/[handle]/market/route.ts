import { NextRequest, NextResponse } from "next/server";
import { fetchXTrackerPosts } from "@/lib/xtracker";

function isValidIsoDateTime(value: string | null) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
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
  const startAt = searchParams.get("startAt");
  const endAt = searchParams.get("endAt");

  if (!handle) {
    return NextResponse.json({ message: "Missing handle" }, { status: 400 });
  }

  if (!isValidIsoDateTime(startAt) || !isValidIsoDateTime(endAt)) {
    return NextResponse.json(
      { message: "Query params startAt and endAt must be valid ISO datetimes" },
      { status: 400 }
    );
  }

  try {
    const postsResult = await fetchXTrackerPosts({
      handle,
      start: startAt!.slice(0, 10),
      end: endAt!.slice(0, 10),
      startAt,
      endAt,
    });

    return NextResponse.json(
      {
        rangePostCount: postsResult.rawCount,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fetchPolymarketBracketHistory } from "@/lib/polymarket";

function sanitizeHandle(rawHandle: string) {
  return rawHandle.replace(/^@+/, "").trim().toLowerCase();
}

function isValidIsoDateTime(value: string | null) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
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

  if (!handle) {
    return NextResponse.json({ message: "Missing handle" }, { status: 400 });
  }

  if (!eventSlug) {
    return NextResponse.json({ message: "Missing eventSlug" }, { status: 400 });
  }

  if (!isValidIsoDateTime(endAt)) {
    return NextResponse.json({ message: "Invalid endAt datetime" }, { status: 400 });
  }

  try {
    const payload = await fetchPolymarketBracketHistory({
      endAt: endAt as string,
      eventSlug,
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

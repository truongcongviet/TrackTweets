import { NextRequest, NextResponse } from "next/server";
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
  const limitValue = Number(searchParams.get("limit") ?? "8");
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 30) : 8;

  if (!handle) {
    return NextResponse.json({ message: "Missing handle" }, { status: 400 });
  }

  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return NextResponse.json(
      { message: "Query params start and end must use YYYY-MM-DD format" },
      { status: 400 }
    );
  }

  try {
    const postsResult = await fetchXTrackerPosts({
      handle,
      start: start as string,
      end: end as string,
    });

    const posts = [...postsResult.posts]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, limit)
      .map((post, index) => ({
        createdAt: post.timestamp,
        id: post.id ?? `${post.timestamp}-${index}`,
        text: post.content,
        url: post.id ? `https://x.com/${handle}/status/${post.id}` : null,
      }));

    return NextResponse.json(
      {
        handle,
        posts,
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

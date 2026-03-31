const XTRACKER_API_URL = "https://xtracker.polymarket.com/api";

type XTrackerPost = {
  id?: string | number;
  createdAt?: string;
  created_at?: string;
  postedAt?: string;
  posted_at?: string;
  timestamp?: string;
};

type XTrackerPostsPayload = {
  data?: XTrackerPost[];
};

function normalizeDateBoundary(date: string, offsetDays: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date boundary");
  }

  parsed.setUTCDate(parsed.getUTCDate() + offsetDays);
  return parsed.toISOString().slice(0, 10);
}

function extractTimestamp(post: XTrackerPost) {
  return (
    post.createdAt ??
    post.created_at ??
    post.postedAt ??
    post.posted_at ??
    post.timestamp ??
    null
  );
}

export async function fetchXTrackerPosts(input: {
  handle: string;
  start: string;
  end: string;
}) {
  const { handle, start, end } = input;

  const url = new URL(`${XTRACKER_API_URL}/users/${encodeURIComponent(handle)}/posts`);
  url.searchParams.set("platform", "X");
  url.searchParams.set("timezone", "EST");
  url.searchParams.set("startDate", normalizeDateBoundary(start, -1));
  url.searchParams.set("endDate", normalizeDateBoundary(end, 1));

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`XTracker request failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const payload = (await response.json()) as XTrackerPostsPayload;
  return (payload.data ?? [])
    .map(extractTimestamp)
    .filter((value): value is string => typeof value === "string");
}

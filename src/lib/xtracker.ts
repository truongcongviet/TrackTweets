const XTRACKER_API_URL = "https://xtracker.polymarket.com/api";
const XTRACKER_CACHE_SECONDS = 60;
const ALL_TIME_START_DATE = "2006-01-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

type XTrackerPost = {
  id?: string | number;
  createdAt?: string;
  created_at?: string;
  postedAt?: string;
  posted_at?: string;
  timestamp?: string;
  content?: string;
};

type XTrackerPostsPayload = {
  success?: boolean;
  data?: XTrackerPost[];
};

type XTrackerTrackingPayload = {
  id?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  marketLink?: string | null;
  isActive?: boolean;
};

type XTrackerUserPayload = {
  success?: boolean;
  data?: {
    name?: string;
    avatarUrl?: string;
    lastSync?: string;
    trackings?: XTrackerTrackingPayload[];
    _count?: {
      posts?: number;
    };
  };
};

type XTrackerTrackingsPayload = {
  success?: boolean;
  data?: XTrackerTrackingPayload[];
};

export type XTrackerTracking = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  marketLink: string | null;
  isActive: boolean;
};

export type XTrackerPostRecord = {
  content: string;
  id: string | null;
  timestamp: string;
};

export type XTrackerUserSummary = {
  name: string | null;
  avatarUrl: string | null;
  lastSync: string | null;
  allTimePostCount: number;
  trackings: XTrackerTracking[];
};

export type XTrackerPostsResult = {
  posts: XTrackerPostRecord[];
  timestamps: string[];
  rawCount: number;
};

export type XTrackerLifetimeStats = {
  originalPostCount: number;
  retweetCount: number;
  averageLength: number;
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

function extractContent(post: XTrackerPost) {
  return typeof post.content === "string" ? post.content : "";
}

function normalizeTracking(tracking: XTrackerTrackingPayload): XTrackerTracking | null {
  if (!tracking.startDate || !tracking.endDate) {
    return null;
  }

  return {
    id: tracking.id ?? `${tracking.startDate}:${tracking.endDate}`,
    title: tracking.title ?? "Untitled tracking",
    startDate: tracking.startDate,
    endDate: tracking.endDate,
    marketLink: tracking.marketLink ?? null,
    isActive: tracking.isActive ?? false,
  };
}

function isSevenDayTracking(tracking: XTrackerTracking) {
  const startMs = Date.parse(tracking.startDate);
  const endMs = Date.parse(tracking.endDate);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return false;
  }

  return Math.round((endMs - startMs) / DAY_MS) === 7;
}

function isRetweet(content: string) {
  return /^RT\s+@/i.test(content.trim());
}

function getLifetimeEndDate(lastSync: string | null) {
  if (!lastSync) {
    return new Date().toISOString();
  }

  const parsed = new Date(lastSync);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

async function fetchXTrackerJson<T>(input: { pathname: string; searchParams?: URLSearchParams }) {
  const url = new URL(`${XTRACKER_API_URL}${input.pathname}`);

  if (input.searchParams) {
    url.search = input.searchParams.toString();
  }

  const response = await fetch(url, {
    next: {
      revalidate: XTRACKER_CACHE_SECONDS,
    },
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`XTracker request failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

async function fetchXTrackerPostsByWindow(input: {
  handle: string;
  startDate: string;
  endDate: string;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set("startDate", input.startDate);
  searchParams.set("endDate", input.endDate);

  const payload = await fetchXTrackerJson<XTrackerPostsPayload>({
    pathname: `/users/${encodeURIComponent(input.handle)}/posts`,
    searchParams,
  });

  return (payload.data ?? [])
    .map((post) => {
      const timestamp = extractTimestamp(post);
      if (!timestamp) return null;

      return {
        content: extractContent(post),
        id:
          typeof post.id === "string" || typeof post.id === "number" ? String(post.id) : null,
        timestamp,
      };
    })
    .filter((post): post is XTrackerPostRecord => post !== null);
}

export async function fetchXTrackerUserSummary(handle: string): Promise<XTrackerUserSummary> {
  const payload = await fetchXTrackerJson<XTrackerUserPayload>({
    pathname: `/users/${encodeURIComponent(handle)}`,
  });

  return {
    name: payload.data?.name ?? null,
    avatarUrl: payload.data?.avatarUrl ?? null,
    lastSync: payload.data?.lastSync ?? null,
    allTimePostCount: payload.data?._count?.posts ?? 0,
    trackings: (payload.data?.trackings ?? [])
      .map(normalizeTracking)
      .filter((tracking): tracking is XTrackerTracking => tracking !== null)
      .sort((left, right) => left.endDate.localeCompare(right.endDate)),
  };
}

export async function fetchXTrackerTrackings(handle: string): Promise<XTrackerTracking[]> {
  const searchParams = new URLSearchParams();
  searchParams.set("platform", "X");

  const payload = await fetchXTrackerJson<XTrackerTrackingsPayload>({
    pathname: `/users/${encodeURIComponent(handle)}/trackings`,
    searchParams,
  });

  const now = Date.now();

  return (payload.data ?? [])
    .map(normalizeTracking)
    .filter((tracking): tracking is XTrackerTracking => tracking !== null)
    .filter((tracking) => isSevenDayTracking(tracking))
    .filter((tracking) => Date.parse(tracking.endDate) >= now)
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
}

export async function fetchXTrackerPosts(input: {
  handle: string;
  start: string;
  end: string;
  startAt?: string | null;
  endAt?: string | null;
}): Promise<XTrackerPostsResult> {
  const posts =
    input.startAt && input.endAt
      ? await fetchXTrackerPostsByWindow({
          handle: input.handle,
          startDate: input.startAt,
          endDate: input.endAt,
        })
      : await fetchXTrackerPostsByWindow({
          handle: input.handle,
          startDate: normalizeDateBoundary(input.start, -1),
          endDate: normalizeDateBoundary(input.end, 1),
        });

  return {
    posts,
    timestamps: posts.map((post) => post.timestamp),
    rawCount: posts.length,
  };
}

export async function fetchXTrackerLifetimeStats(input: {
  handle: string;
  lastSync: string | null;
}): Promise<XTrackerLifetimeStats> {
  const posts = await fetchXTrackerPostsByWindow({
    handle: input.handle,
    startDate: ALL_TIME_START_DATE,
    endDate: getLifetimeEndDate(input.lastSync),
  });

  if (posts.length === 0) {
    return {
      originalPostCount: 0,
      retweetCount: 0,
      averageLength: 0,
    };
  }

  let retweetCount = 0;
  let totalLength = 0;

  for (const post of posts) {
    totalLength += post.content.length;
    if (isRetweet(post.content)) {
      retweetCount += 1;
    }
  }

  return {
    originalPostCount: posts.length - retweetCount,
    retweetCount,
    averageLength: Math.round(totalLength / posts.length),
  };
}

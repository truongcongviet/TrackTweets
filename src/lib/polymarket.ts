import type {
  PolymarketHistoryPoint,
  PolymarketHistoryResponse,
  PolymarketHistoryRow,
  PolymarketHistoryWindow,
  PolymarketHistoryWindowId,
} from "@/lib/types";

const POLYMARKET_GAMMA_API_URL = "https://gamma-api.polymarket.com";
const POLYMARKET_CLOB_API_URL = "https://clob.polymarket.com";
const POLYMARKET_CACHE_SECONDS = 60;
const BATCH_HISTORY_LIMIT = 20;
const BRACKET_VISIBLE_MAX = 499;
const BRACKET_VISIBLE_MIN = 120;
const HISTORY_PADDING_HOURS = 2;
const VISIBLE_BRACKET_RANGE_LABEL = `${BRACKET_VISIBLE_MIN}-${BRACKET_VISIBLE_MAX}`;

const HISTORY_WINDOWS: PolymarketHistoryWindow[] = [
  { id: "1h", label: "1H", hours: 1 },
  { id: "3h", label: "3H", hours: 3 },
  { id: "6h", label: "6H", hours: 6 },
  { id: "12h", label: "12H", hours: 12 },
  { id: "24h", label: "24H", hours: 24 },
];

type GammaEventMarketPayload = {
  active?: boolean;
  clobTokenIds?: string | string[];
  closed?: boolean;
  enableOrderBook?: boolean;
  outcomePrices?: string | string[];
  question?: string;
  slug?: string;
  umaResolutionStatus?: string;
};

type GammaEventPayload = {
  endDate?: string;
  markets?: GammaEventMarketPayload[];
  slug?: string;
  title?: string;
};

type PriceHistoryPoint = {
  p?: number;
  t?: number;
};

type BatchPriceHistoryPayload = {
  history?: Record<string, PriceHistoryPoint[]>;
};

type PolymarketBracketMarket = {
  bracket: string;
  finalPricePct: number | null;
  isResolved: boolean;
  marketSlug: string;
  noTokenId: string | null;
  yesTokenId: string;
};

async function fetchPolymarketJson<T>(url: URL, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json, text/plain, */*",
      ...(init?.headers ?? {}),
    },
    next: {
      revalidate: POLYMARKET_CACHE_SECONDS,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Polymarket request failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

function parseStringArray(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseOutcomePrices(value: string | string[] | undefined) {
  const rawValues = parseStringArray(value);

  return rawValues
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function getBracketFromQuestion(question: string | undefined, slug: string | undefined) {
  const questionMatch = question?.match(/\b(\d+\-\d+|\d+\+)\b/);
  if (questionMatch) {
    return questionMatch[1];
  }

  const slugMatch = slug?.match(/-(\d+\-\d+|\d+plus)$/i);
  if (!slugMatch) {
    return slug ?? "Unknown";
  }

  return slugMatch[1].replace(/plus$/i, "+");
}

function getBracketStart(value: string) {
  const numeric = Number(value.split("-")[0]?.replace("+", ""));
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function isBracketWithinVisibleRange(bracket: string) {
  const bracketStart = getBracketStart(bracket);
  return bracketStart >= BRACKET_VISIBLE_MIN && bracketStart <= BRACKET_VISIBLE_MAX;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizePricePct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 10;
}

function getSnapshotValue(history: PriceHistoryPoint[], targetTs: number) {
  const validHistory = history
    .filter(
      (point): point is Required<PriceHistoryPoint> =>
        typeof point.t === "number" && typeof point.p === "number"
    )
    .sort((left, right) => left.t - right.t);

  for (let index = validHistory.length - 1; index >= 0; index -= 1) {
    if (validHistory[index].t <= targetTs) {
      return normalizePricePct(validHistory[index].p);
    }
  }

  return null;
}

function getLatestPoint(history: PriceHistoryPoint[]) {
  const validHistory = history.filter(
    (point): point is Required<PriceHistoryPoint> =>
      typeof point.t === "number" && typeof point.p === "number"
  );

  if (!validHistory.length) {
    return null;
  }

  return validHistory.reduce((latest, current) => {
    if (!latest || current.t > latest.t) {
      return current;
    }

    return latest;
  }, validHistory[0] ?? null);
}

function toHistoryTimeline(history: PriceHistoryPoint[]): PolymarketHistoryPoint[] {
  return history
    .filter(
      (point): point is Required<PriceHistoryPoint> =>
        typeof point.t === "number" && typeof point.p === "number"
    )
    .sort((left, right) => left.t - right.t)
    .map((point) => ({
      pricePct: normalizePricePct(point.p),
      ts: point.t,
    }));
}

async function fetchEventBySlug(eventSlug: string) {
  const url = new URL(`${POLYMARKET_GAMMA_API_URL}/events/slug/${encodeURIComponent(eventSlug)}`);
  return fetchPolymarketJson<GammaEventPayload>(url);
}

async function fetchBatchHistory(input: {
  endTs: number;
  startTs: number;
  tokenIds: string[];
}) {
  const history = new Map<string, PriceHistoryPoint[]>();

  for (const chunk of chunkArray(input.tokenIds, BATCH_HISTORY_LIMIT)) {
    const url = new URL(`${POLYMARKET_CLOB_API_URL}/batch-prices-history`);
    const payload = await fetchPolymarketJson<BatchPriceHistoryPayload>(url, {
      body: JSON.stringify({
        end_ts: input.endTs,
        fidelity: 60,
        interval: "1h",
        markets: chunk,
        start_ts: input.startTs,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    for (const tokenId of chunk) {
      history.set(tokenId, payload.history?.[tokenId] ?? []);
    }
  }

  return history;
}

function getLeaderByWindow(rows: PolymarketHistoryRow[]) {
  return HISTORY_WINDOWS.reduce(
    (leaders, window) => {
      const leader = rows.reduce<PolymarketHistoryRow | null>((currentLeader, row) => {
        const value = row.values[window.id];

        if (value === null) {
          return currentLeader;
        }

        if (!currentLeader) {
          return row;
        }

        const leaderValue = currentLeader.values[window.id];
        if (leaderValue === null || value > leaderValue) {
          return row;
        }

        return currentLeader;
      }, null);

      leaders[window.id] = leader?.bracket ?? null;
      return leaders;
    },
    {} as Record<PolymarketHistoryWindowId, string | null>
  );
}

function getBracketMarkets(event: GammaEventPayload) {
  const markets: PolymarketBracketMarket[] = [];

  for (const market of event.markets ?? []) {
    if (!market.enableOrderBook) {
      continue;
    }

    const tokenIds = parseStringArray(market.clobTokenIds);
    const yesTokenId = tokenIds[0] ?? null;

    if (!yesTokenId) {
      continue;
    }

    markets.push({
      bracket: getBracketFromQuestion(market.question, market.slug),
      finalPricePct:
        market.closed && market.umaResolutionStatus === "resolved"
          ? normalizePricePct(parseOutcomePrices(market.outcomePrices)[0] ?? null)
          : null,
      isResolved: market.closed === true && market.umaResolutionStatus === "resolved",
      marketSlug: market.slug ?? yesTokenId,
      noTokenId: tokenIds[1] ?? null,
      yesTokenId,
    });
  }

  return markets.sort((left, right) => getBracketStart(left.bracket) - getBracketStart(right.bracket));
}

function getResolvedWinnerBracket(markets: PolymarketBracketMarket[]) {
  return markets.find((market) => market.finalPricePct !== null && market.finalPricePct >= 100)?.bracket ?? null;
}

function formatAsOfLabel(asOfTs: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(asOfTs * 1000));
}

export function extractPolymarketEventSlug(marketLink: string | null) {
  if (!marketLink) return null;

  try {
    const url = new URL(marketLink);
    const segments = url.pathname.split("/").filter(Boolean);
    const eventIndex = segments.findIndex((segment) => segment === "event");

    if (eventIndex === -1) {
      return null;
    }

    return segments[eventIndex + 1] ?? null;
  } catch {
    return null;
  }
}

export async function fetchPolymarketBracketHistory(input: {
  endAt: string;
  eventSlug: string;
}): Promise<PolymarketHistoryResponse> {
  const event = await fetchEventBySlug(input.eventSlug);
  const allMarkets = getBracketMarkets(event);
  const resolvedWinnerBracket = getResolvedWinnerBracket(allMarkets);
  const markets = allMarkets.filter((market) => isBracketWithinVisibleRange(market.bracket));

  if (!markets.length) {
    return {
      asOfLabel: formatAsOfLabel(Math.floor(Date.now() / 1000)),
      asOfTs: Math.floor(Date.now() / 1000),
      eventSlug: input.eventSlug,
      eventTitle: event.title ?? input.eventSlug,
      leaders: {
        "1h": null,
        "3h": null,
        "6h": null,
        "12h": null,
        "24h": null,
      },
      resolvedWinnerBracket,
      rows: [],
      visibleBracketRangeLabel: VISIBLE_BRACKET_RANGE_LABEL,
      windows: HISTORY_WINDOWS,
    };
  }

  const endAtMs = Date.parse(input.endAt);
  const eventEndMs = Date.parse(event.endDate ?? "");
  const nowMs = Date.now();
  const asOfMs = Math.min(
    Number.isNaN(endAtMs) ? nowMs : endAtMs,
    Number.isNaN(eventEndMs) ? nowMs : eventEndMs,
    nowMs
  );
  const asOfTs = Math.floor(asOfMs / 1000);
  const maxLookbackHours = Math.max(...HISTORY_WINDOWS.map((window) => window.hours));
  const startTs = asOfTs - (maxLookbackHours + HISTORY_PADDING_HOURS) * 60 * 60;
  const historyByTokenId = await fetchBatchHistory({
    endTs: asOfTs,
    startTs,
    tokenIds: markets.map((market) => market.yesTokenId),
  });

  const rows = markets.map<PolymarketHistoryRow>((market) => {
    const history = historyByTokenId.get(market.yesTokenId) ?? [];
    const latestPoint = getLatestPoint(history);
    const historyPoints = toHistoryTimeline(history);

    return {
      bracket: market.bracket,
      finalPricePct: market.finalPricePct,
      historyPoints,
      isResolved: market.isResolved,
      latestPricePct: normalizePricePct(latestPoint?.p ?? null),
      latestTimestamp: latestPoint?.t ?? null,
      marketSlug: market.marketSlug,
      noTokenId: market.noTokenId,
      values: HISTORY_WINDOWS.reduce(
        (values, window) => {
          values[window.id] = getSnapshotValue(history, asOfTs - window.hours * 60 * 60);
          return values;
        },
        {} as Record<PolymarketHistoryWindowId, number | null>
      ),
      yesTokenId: market.yesTokenId,
    };
  });

  return {
    asOfLabel: formatAsOfLabel(asOfTs),
    asOfTs,
    eventSlug: event.slug ?? input.eventSlug,
    eventTitle: event.title ?? input.eventSlug,
    leaders: getLeaderByWindow(rows),
    resolvedWinnerBracket,
    rows,
    visibleBracketRangeLabel: VISIBLE_BRACKET_RANGE_LABEL,
    windows: HISTORY_WINDOWS,
  };
}

export type HourKey =
  | "00"
  | "01"
  | "02"
  | "03"
  | "04"
  | "05"
  | "06"
  | "07"
  | "08"
  | "09"
  | "10"
  | "11"
  | "12"
  | "13"
  | "14"
  | "15"
  | "16"
  | "17"
  | "18"
  | "19"
  | "20"
  | "21"
  | "22"
  | "23";

export type HeatmapRow = {
  date: string;
  hours: Record<HourKey, number>;
  total: number;
};

export type TrackingWindow = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  marketLink: string | null;
  isActive: boolean;
};

export type HourlyHeatmapBase = {
  handle: string;
  timezone: string;
  start: string;
  end: string;
  maxHourlyCount: number;
  grandTotal: number;
  rows: HeatmapRow[];
};

export type HourlyHeatmapResponse = HourlyHeatmapBase & {
  name: string | null;
  avatarUrl: string | null;
  lastSync: string | null;
  allTimePostCount: number;
  allTimeOriginalCount: number;
  allTimeRetweetCount: number;
  allTimeAverageLength: number;
  rangePostCount: number;
  trackings: TrackingWindow[];
};

export type PolymarketHistoryWindowId = "24h" | "12h" | "6h" | "3h" | "1h";

export type PolymarketHistoryWindow = {
  hours: number;
  id: PolymarketHistoryWindowId;
  label: string;
};

export type PolymarketHistoryPoint = {
  pricePct: number | null;
  ts: number;
};

export type PolymarketHistoryRow = {
  bracket: string;
  finalPricePct: number | null;
  historyPoints: PolymarketHistoryPoint[];
  isResolved: boolean;
  latestPricePct: number | null;
  latestTimestamp: number | null;
  marketSlug: string;
  noTokenId: string | null;
  values: Record<PolymarketHistoryWindowId, number | null>;
  yesTokenId: string;
};

export type PolymarketHistoryResponse = {
  asOfLabel: string;
  asOfTs: number;
  eventSlug: string;
  eventTitle: string;
  leaders: Record<PolymarketHistoryWindowId, string | null>;
  resolvedWinnerBracket: string | null;
  rows: PolymarketHistoryRow[];
  visibleBracketRangeLabel: string;
  windows: PolymarketHistoryWindow[];
};

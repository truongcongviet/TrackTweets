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

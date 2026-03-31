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

export type HourlyHeatmapResponse = {
  handle: string;
  timezone: string;
  start: string;
  end: string;
  maxHourlyCount: number;
  grandTotal: number;
  rows: HeatmapRow[];
};

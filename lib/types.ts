export type Settings = {
  timezone: string;
  intervalMin: number;
  startHour: number;
  endHour: number;
  goalMl: number;
  glassMl: number;
  enabled: boolean;
};

export type LogEntry = { id: string; amountMl: number; at: string };

export type SupplementView = {
  id: string;
  name: string;
  timeOfDay: string;
  enabled: boolean;
  takenToday: boolean;
};

export type State = {
  settings: Settings;
  todayMl: number;
  logs: LogEntry[];
  subscribed: boolean;
  nextReminderAt: string | null;
  supplements: SupplementView[];
};

export type HistoryDay = { date: string; totalMl: number };

export type History = {
  days: HistoryDay[];
  goalMl: number;
  streak: number;
};

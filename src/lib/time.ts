export interface TimeRange {
  start: number;
  end: number;
}

export function getTimeRange(period: string, start?: string, end?: string): TimeRange {
  const now = Math.floor(Date.now() / 1000);
  const daySeconds = 86400;

  switch (period) {
    case "today": {
      const todayStart = now - (now % daySeconds);
      return { start: todayStart, end: now };
    }
    case "7d":
      return { start: now - 7 * daySeconds, end: now };
    case "30d":
      return { start: now - 30 * daySeconds, end: now };
    case "90d":
      return { start: now - 90 * daySeconds, end: now };
    case "custom": {
      const s = start ? Math.floor(new Date(start).getTime() / 1000) : now - 30 * daySeconds;
      const e = end ? Math.floor(new Date(end).getTime() / 1000) + daySeconds - 1 : now;
      return { start: s, end: e };
    }
    default:
      return { start: now - 30 * daySeconds, end: now };
  }
}

import type { History } from "@/lib/types";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WIDTH = 280;
const HEIGHT = 120;
const BAR_GAP = 8;

export function HistoryChart({ history }: { history: History }) {
  const { days, goalMl, streak } = history;
  const max = Math.max(goalMl, ...days.map((d) => d.totalMl), 1);
  const barWidth = (WIDTH - BAR_GAP * (days.length - 1)) / days.length;
  const goalY = HEIGHT - (goalMl / max) * HEIGHT;

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Water intake, last 7 days">
        <line x1={0} y1={goalY} x2={WIDTH} y2={goalY} stroke="currentColor" className="text-foam/30" strokeDasharray="4 4" strokeWidth={1} />
        {days.map((d, i) => {
          const barHeight = (d.totalMl / max) * HEIGHT;
          const x = i * (barWidth + BAR_GAP);
          const hitGoal = d.totalMl >= goalMl;
          return (
            <rect
              key={d.date}
              x={x}
              y={HEIGHT - barHeight}
              width={barWidth}
              height={barHeight}
              rx={4}
              className={hitGoal ? "fill-water" : "fill-foam/30"}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex text-xs text-foam/50" style={{ gap: `${BAR_GAP}px` }}>
        {days.map((d) => (
          <span key={d.date} style={{ width: `${barWidth}px` }} className="text-center">
            {WEEKDAY[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}
          </span>
        ))}
      </div>
      <p className="mt-3 text-sm text-foam/80">
        {streak > 0 ? `🔥 ${streak} day${streak === 1 ? "" : "s"} hitting your goal` : "🦋 Hit your goal today to start a streak."}
      </p>
    </div>
  );
}

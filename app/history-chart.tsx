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
      {streak > 0 ? (
        <div className="mt-3">
          <p className="text-sm text-foam/80">
            {streak} day{streak === 1 ? "" : "s"} hitting your goal
          </p>
          <div className="mt-1 flex flex-wrap gap-1 text-lg" aria-hidden="true">
            {Array.from({ length: Math.min(streak, 10) }, (_, i) => (
              <span key={i} className="streak-pop" style={{ animationDelay: `${i * 60}ms` }}>
                🦋
              </span>
            ))}
            {streak > 10 && <span className="self-center text-xs text-foam/50">+{streak - 10} more</span>}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-foam/80">🦋 Hit your goal today to start a streak.</p>
      )}
    </div>
  );
}

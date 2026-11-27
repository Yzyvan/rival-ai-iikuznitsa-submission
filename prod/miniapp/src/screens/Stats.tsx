import { useState } from "react";
import { stats } from "../data/content";
import { IconButton, Section, StatTile, Status, Tags } from "../ui";
import { whoop } from "../haptics";
import { useNav } from "../nav";

/** Статы: отчёт за неделю — загрузка по часам, четыре показателя, дни. */
export function Stats() {
  const nav = useNav();
  const h = stats.heatmap;
  return (
    <div className="screen">
      <div className="scroll">
        <header className="header">
          <span className="header__title t-body-l">{stats.title}</span>
          <IconButton icon="share" label="Поделиться" onClick={() => nav("toast:t7")} />
        </header>
        <div className="stack pad-for-bar" style={{ gap: 24, padding: "16px 16px 132px" }}>
          <section className="heatmap">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="t-body-m-medium">{h.title}</span>
              <Status label={h.peak} type="Проблема" tone="Темная" />
            </div>
            <div className="heatmap__grid">
              {h.days.map(([day, cells]) => (
                <div key={day} className="heatmap__line">
                  <span className="t-caption c-tertiary">{day}</span>
                  {cells.map((step, i) => <span key={i} className="heatmap__cell" style={{ background: `var(--vilar-${step})` }} />)}
                </div>
              ))}
            </div>
            <div className="heatmap__axis t-caption c-tertiary">{h.axis.map((a) => <span key={a}>{a}</span>)}</div>
          </section>

          <div className="stats-grid">
            {stats.tiles.map((t) => <StatTile key={t.label} {...t} />)}
          </div>

          <ByDay />
        </div>
      </div>
    </div>
  );
}

const fmt = (v: number, minutes?: boolean) => (minutes ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}` : String(v));

/** По дням: переключатель метрик и столбцы по дням недели. Высота — от лучшего дня, он подсвечен. */
function ByDay() {
  const { days, metrics } = stats.byDay;
  const [id, setId] = useState(metrics[0].id);
  const m = metrics.find((x) => x.id === id) ?? metrics[0];
  const max = Math.max(...m.vals);
  const peak = m.vals.indexOf(max);
  return (
    <Section title="По дням">
      <div className="metric-chips hscroll" role="tablist">
        {metrics.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === id} className={`metric-chip t-body-m-medium${x.id === id ? " is-on" : ""}`}
                  onClick={() => { if (x.id !== id) whoop(); setId(x.id); }}>{x.label}</button>
        ))}
      </div>
      <div className="byday__total">
        <span className="t-title-l">{m.total}</span>
        <span className="t-body-m c-secondary">{m.totalSub}</span>
      </div>
      <div className="bars">
        {m.vals.map((v, i) => (
          <div key={days[i]} className={`bars__col${i === peak ? " is-peak" : ""}`}>
            <span className={i === peak ? "t-body-m-medium" : "t-caption c-secondary"}>{fmt(v, m.minutes)}</span>
            <span className={`bars__bar${v === 0 ? " is-zero" : ""}`} style={{ height: v === 0 ? 4 : Math.max(8, Math.round((140 * v) / max)) }} />
            <span className={`t-caption-medium ${i === peak ? "" : i >= 5 ? "c-tertiary" : "c-secondary"}`}>{days[i]}</span>
          </div>
        ))}
      </div>
      <Tags items={m.notes} />
    </Section>
  );
}

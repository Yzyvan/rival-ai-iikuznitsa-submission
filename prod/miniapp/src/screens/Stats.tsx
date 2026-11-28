import { useState } from "react";
import { hasAccountLaunch } from "../api/mailBoard";
import { useTaskRead, type TaskList } from "../../../../integrations/tracker/transport/bindings";
import { useImportedMail } from "./MailBoard";
import { useCalendar } from "./CalendarBoard";
import { useApprovals } from "./LiveOverview";
import { stats } from "../data/content";
import { IconButton, Section, StatTile, Status, Tags } from "../ui";
import { whoop } from "../haptics";
import { useNav } from "../nav";

/** Статы: отчёт за неделю — загрузка по часам, четыре показателя, дни. */
export function Stats() {
  return hasAccountLaunch ? <AccountStats /> : <Report report={stats} />;
}

type ReportData = Omit<typeof stats, "tiles"> & {tiles: ReadonlyArray<Parameters<typeof StatTile>[0]>};

function Report({ report, live }: { report: ReportData; live?: boolean }) {
  const nav = useNav();
  const h = report.heatmap;
  return (
    <div className="screen">
      <div className="scroll">
        <header className="header">
          <span className="header__title t-body-l">{report.title}</span>
          {!live && <IconButton icon="share" label="Поделиться" onClick={() => nav("toast:t7")} />}
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
            {report.tiles.map((t) => <StatTile key={t.label} {...t} />)}
          </div>

          <ByDay data={report.byDay} />
        </div>
      </div>
    </div>
  );
}

const fmt = (v: number, minutes?: boolean) => (minutes ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}` : String(v));

/** По дням: переключатель метрик и столбцы по дням недели. Высота — от лучшего дня, он подсвечен. */
function ByDay({ data: {days, metrics} }: {data: typeof stats.byDay}) {
  const [id, setId] = useState(metrics[0].id);
  const m = metrics.find((x) => x.id === id) ?? metrics[0];
  const max = Math.max(...m.vals);
  const peak = max > 0 ? m.vals.indexOf(max) : -1;
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
      {m.notes.length > 0 && <Tags items={m.notes} />}
    </Section>
  );
}

const moscowDate = new Intl.DateTimeFormat("sv-SE", {timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit"});
const dayTitle = new Intl.DateTimeFormat("ru-RU", {timeZone: "UTC", day: "numeric", month: "short"});

function AccountStats() {
  const mail = useImportedMail();
  const calendar = useCalendar(true);
  const tasks = useTaskRead<TaskList>("tasks");
  const approvals = useApprovals(true);
  const failed = mail.error || calendar.error || tasks.error || approvals.error;
  if (failed || !mail.messages || !calendar.meetings || !tasks.data || !approvals.data) {
    return <div className="screen"><div className="scroll"><header className="header"><span className="header__title t-body-l">Итоги</span></header>
      <div className="body"><p role="status" className="t-body-m c-secondary">{failed ? "Не удалось загрузить данные отчёта." : "Загрузка…"}</p></div></div></div>;
  }
  const today = new Date(moscowDate.format(new Date()) + "T00:00:00Z");
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7);
  const dates = stats.byDay.days.map((_, i) => new Date(monday.getTime() + i * 86400000));
  const days = dates.map(d => d.toISOString().slice(0, 10));
  const letters = days.map(d => mail.messages!.filter(m => m.day === d).length);
  const meetings = days.map(d => calendar.meetings!.filter(m => moscowDate.format(new Date(m.start)) === d).length);
  const hours = days.map(d => Array.from({length: 13}, (_, i) => {
    const from = Date.parse(d + "T" + String(i + 9).padStart(2, "0") + ":00:00+03:00");
    return calendar.meetings!.filter(m => !m.all_day && Date.parse(m.start) < from + 3600000 && Date.parse(m.end) > from).length;
  }));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const dailyLoad = hours.map(sum);
  const peak = dailyLoad.indexOf(Math.max(...dailyLoad));
  const metric = (id: string, label: string, vals: number[], totalSub: string) => ({id,label,vals,total:String(sum(vals)),totalSub,notes:[]});
  return <Report live report={{
    title: "Неделя " + dayTitle.format(dates[0]) + " – " + dayTitle.format(dates[6]),
    heatmap: {title: "Встречи по дням и часам", axis: stats.heatmap.axis,
      peak: dailyLoad[peak] ? "пик — " + stats.byDay.days[peak] : "нет встреч в эти часы",
      days: hours.map((row, i) => [stats.byDay.days[i], row.map(v => [950,600,400,200][Math.min(3,v)])])},
    tiles: [
      {label:"Писем",value:String(sum(letters)),caption:"загружено за неделю",icon:"mail",level:"Хорошо"},
      {label:"Встреч",value:String(sum(meetings)),caption:"в календаре на неделю",icon:"calendar",level:"Хорошо"},
      {label:"Задач",value:String(tasks.data.rows.length),caption:"на доске сейчас",icon:"clipboard",level:"Хорошо"},
      {label:"На согласовании",value:String(approvals.data.rows.length),caption:"сейчас",icon:"check-circle",level:"Внимание"}],
    byDay:{days:stats.byDay.days,metrics:[metric("letters","Письма",letters,"записей почты за неделю"),metric("meetings","Встречи",meetings,"встреч в календаре за неделю")]}
  }} />;
}

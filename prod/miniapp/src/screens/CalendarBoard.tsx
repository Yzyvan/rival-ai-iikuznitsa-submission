import { useEffect, useState } from "react";
import { fetchBoardData } from "../api/mailBoard";
import { ListRow, Section } from "../ui";

type Meeting = { id: string; title: string; start: string; end: string; all_day: boolean };

export function useCalendar(active: boolean) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetchBoardData("./api/calendar/board", controller.signal);
        if (response.status === 403) throw new Error("Календарь доступен владельцу подключённого ящика.");
        if (!response.ok) throw new Error("Не удалось загрузить встречи.");
        const body = await response.json();
        if (!controller.signal.aborted) { setMeetings(body.meetings); setError(""); }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить встречи.");
          setMeetings(null);
        }
      } finally { running = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [active]);
  return { meetings, error };
}

const day = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" });
const clock = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });

function schedule(m: Meeting) {
  const start = new Date(m.start), end = new Date(m.end);
  if (m.all_day) {
    const last = new Date(Math.max(+start, +end - 1));
    return (day.format(start) === day.format(last) ? day.format(start) : day.format(start) + "–" + day.format(last)) + " · Весь день";
  }
  const endDay = day.format(start) === day.format(end) ? "" : day.format(end) + " ";
  return day.format(start) + " · " + clock.format(start) + "–" + endDay + clock.format(end) + " МСК";
}

export function CalendarBoard({ meetings, error }: ReturnType<typeof useCalendar>) {
  if (error || !meetings?.length) return <Section title="Календарь Outlook">
    <p role="status">{error || (meetings ? "Встреч пока нет." : "Загрузка…")}</p></Section>;
  const now = Date.now();
  return <>{["Предстоящие", "Сейчас", "Прошедшие"].map((section, i) => {
    const rows = meetings.filter(m => (+new Date(m.end) <= now ? 2 : +new Date(m.start) > now ? 0 : 1) === i);
    if (i === 2) rows.reverse();
    return rows.length > 0 && <Section key={section} title={section}>{rows.map(m =>
      <ListRow key={m.id} title={m.title} subtitle={schedule(m)} />)}</Section>;
  })}</>;
}

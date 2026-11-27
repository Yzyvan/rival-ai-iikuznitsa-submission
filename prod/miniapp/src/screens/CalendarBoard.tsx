import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchBoardData, isBrowserTest } from "../api/mailBoard";
import { ListRow, Section } from "../ui";
import { SheetView } from "./SheetView";

type Choice = "delegate" | "personal";
type Meeting = { id: string; title: string; start: string; end: string; all_day: boolean; needs_decision: boolean; choice: Choice | null };

export function useCalendar(active: boolean) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState("");
  const [selectedId, select] = useState<string | null>(null);
  const [revision, reload] = useState(0);
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
  }, [active, revision]);
  const pending = (meetings ?? []).filter(needsChoice);
  const selected = meetings?.find(m => m.id === selectedId);
  const decide = async (action: string) => {
    if (!selected || (action !== "delegate" && action !== "personal")) return;
    const res = await fetchBoardData("./api/calendar/board", undefined, {id: selected.id, choice: action});
    if (res.status === 403) throw new Error("Для подтверждения откройте Vilar из Telegram владельца календаря.");
    if (res.status === 409) {
      reload(v => v + 1);
      throw new Error("Встреча изменилась. Проверьте обновлённое расписание.");
    }
    if (!res.ok) throw new Error("Не удалось сохранить выбор. Попробуйте ещё раз.");
    setMeetings(current => current?.map(m => m.id === selected.id
      ? {...m, needs_decision: false, choice: action} : m) ?? null);
    reload(v => v + 1);
  };
  return { meetings, error, pending, select, selected, decide };
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

function needsChoice(m: Meeting) {
  return m.needs_decision && !m.choice && +new Date(m.end) > Date.now();
}

type Calendar = ReturnType<typeof useCalendar>;

export function CalendarDecisions({ pending, select }: Calendar) {
  return <>{pending.map(m => <ListRow key={m.id} urgent title={m.title} subtitle={schedule(m)}
    status={["кто пойдёт?", "Решение", "Яркая"]} onClick={() => select(m.id)} />)}</>;
}

export function CalendarBoard({ meetings, error, selected, select, decide }: Calendar) {
  if (error || !meetings?.length) return <Section title="Календарь Outlook">
    <p role="status">{error || (meetings ? "Встреч пока нет." : "Загрузка…")}</p></Section>;
  const now = Date.now();
  const minutes = selected ? Math.ceil((+new Date(selected.start) - now) / 60000) : 0;
  const when = minutes <= 0 ? "встреча идёт" : minutes <= 60 ? `через ${minutes} мин` : day.format(new Date(selected!.start));
  return <>
    {["Предстоящие", "Сейчас", "Прошедшие"].map((section, i) => {
      const rows = meetings.filter(m => !needsChoice(m) && (+new Date(m.end) <= now ? 2 : +new Date(m.start) > now ? 0 : 1) === i);
      if (i === 2) rows.reverse();
      return rows.length > 0 && <Section key={section} title={section}>{rows.map(m => (
        <ListRow key={m.id} title={m.title} subtitle={schedule(m)}
          status={m.choice ? [m.choice === "delegate" ? "идёт Vilar" : "лично", "Нейтрально", "Темная"] : undefined}
          onClick={() => select(m.id)} />
      ))}</Section>;
    })}
    {selected && createPortal(
      <SheetView key={selected.id} sheet={{
        title: selected.title,
        tags: [...schedule(selected).split(" · "), "Outlook"],
        status: needsChoice(selected) ? [when, "Внимание", "Яркая"] : undefined,
        msg: needsChoice(selected) ? "В приглашении есть ссылка на Телемост. Я могу пойти на встречу вместо вас. Кто пойдёт?" : undefined,
        actions: needsChoice(selected) && !isBrowserTest ? [["Поручить Vilar", "primary", "delegate"], ["Иду сам", "secondary", "personal"]]
          : [["Закрыть", "ghost", "close"]],
      }} onDecision={decide} onAction={() => select(null)} />,
      document.querySelector(".app")!,
    )}
  </>;
}

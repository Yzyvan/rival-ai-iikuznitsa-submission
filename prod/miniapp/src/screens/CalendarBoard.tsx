import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchBoardData, canEdit } from "../api/mailBoard";
import { Button, ListRow, Section } from "../ui";
import { BoardDocument } from "./BoardDocument";
import { MeetingProtocol } from "./Protocol";
import { SheetView } from "./SheetView";

type Choice = "delegate" | "personal";
type Meeting = { id: string; card_key?: string; can_reschedule?: boolean; title: string; start: string; end: string; all_day: boolean; needs_decision: boolean; choice: Choice | null };

// Older board servers return the revision ID only.
const cardKey = (meeting: Meeting) => meeting.card_key || meeting.id;

export function useCalendar(active: boolean) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const select = (id: string | null) => {
    const meeting = meetings?.find(m => m.id === id);
    setSelectedId(meeting ? cardKey(meeting) : id);
  };
  const selected = meetings?.find(m => cardKey(m) === selectedId);
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
  const reschedule = async (id: string, start: string, end: string, syncing: () => void) => {
    const res = await fetchBoardData("./api/calendar/board", undefined, { id, start, end });
    if (res.status === 409) {
      reload(v => v + 1);
      throw new Error("Проверьте актуальное время встречи перед повторным переносом.");
    }
    if (res.status === 403) {
      const failure = await res.json().catch(() => ({}));
      throw new Error(failure.error === "ineligible" ?
        "Сейчас из Vilar можно переносить одиночные встречи без приглашенных." : "Outlook не разрешил перенести встречу.");
    }
    if (!res.ok) throw new Error("Не удалось подтвердить перенос. Проверьте время встречи.");
    const reply = await res.json() as { meeting?: Meeting; card_key?: string };
    let meeting = reply.meeting;
    if (res.status === 202 && reply.card_key) {
      syncing();
      for (let attempt = 0; attempt < 40 && !meeting; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 2500));
        const refresh = await fetchBoardData("./api/calendar/board");
        if (!refresh.ok) continue;
        const latest = await refresh.json() as { meetings: Meeting[] };
        meeting = latest.meetings.find(m => m.card_key === reply.card_key && m.id !== id &&
          meetingInput(m.start) === start && meetingInput(m.end) === end);
      }
    }
    if (!meeting?.card_key) throw new Error("БД еще не получила новое время из Outlook. Обновите карточку.");
    const updated = meeting;
    setMeetings(current => current?.map(m => cardKey(m) === updated.card_key ? updated : m) ?? null);
    reload(v => v + 1);
  };
  return { meetings, error, pending, select, selected, decide, reschedule };

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
  return <>{pending.map(m => <ListRow key={cardKey(m)} urgent title={m.title} subtitle={schedule(m)}
    status={["кто пойдёт?", "Решение", "Яркая"]} onClick={() => select(cardKey(m))} />)}</>;
}

function meetingInput(value: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return parts.format(new Date(value)).replace(" ", "T");
}

function RescheduleMeeting({ meeting, save }: {
  meeting: Meeting; save: (id: string, start: string, end: string, syncing: () => void) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(() => meetingInput(meeting.start));
  const [end, setEnd] = useState(() => meetingInput(meeting.end));
  const [phase, setPhase] = useState<"idle" | "saving" | "syncing">("idle");
  const [error, setError] = useState("");
  const busy = phase !== "idle";
  if (!editing) return <Button label="Перенести встречу" variant="secondary" fill onClick={() => {
    setStart(meetingInput(meeting.start));
    setEnd(meetingInput(meeting.end));
    setError("");
    setEditing(true);
  }} />;
  const validTimes = Boolean(start && end && start < end);
  const changed = start !== meetingInput(meeting.start) || end !== meetingInput(meeting.end);
  const submit = async () => {
    if (busy || !validTimes || !changed) return;
    setPhase("saving");
    setError("");
    try {
      await save(meeting.id, start, end, () => setPhase("syncing"));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось перенести встречу.");
    } finally { setPhase("idle"); }
  };
  return <form className="draft-card" onSubmit={e => { e.preventDefault(); void submit(); }} aria-busy={busy}>
    <label className="t-body-m">Начало, МСК
      <input className="draft-card__input" type="datetime-local" required value={start} disabled={busy}
        onChange={e => {
          const next = e.target.value;
          if (next && validTimes) {
            const duration = Date.parse(end + "Z") - Date.parse(start + "Z");
            setEnd(new Date(Date.parse(next + "Z") + duration).toISOString().slice(0, 16));
          }
          setStart(next);
        }} />
    </label>
    <label className="t-body-m">Окончание, МСК
      <input className="draft-card__input" type="datetime-local" required value={end} disabled={busy}
        onChange={e => setEnd(e.target.value)} />
    </label>
    {phase === "saving" && <p role="status">Сохраняю новое время в Outlook…</p>}
    {phase === "syncing" && <p role="status">Outlook сохранил время. Обновляю карточку…</p>}
    {error && <p role="alert">{error}</p>}
    {!busy && !error && !validTimes && <p role="status">Окончание должно быть позже начала.</p>}
    {!busy && !error && validTimes && !changed && <p role="status">Выбери новое время встречи.</p>}
    {!busy && <>
      <button className="btn btn--primary" type="submit" disabled={!validTimes || !changed}>Сохранить перенос</button>
      <Button label="Отменить правку" variant="secondary" fill onClick={() => setEditing(false)} />
    </>}
  </form>;
}

export function CalendarBoard({ meetings, error, selected, select, decide, reschedule }: Calendar) {
  const [protocolId, setProtocolId] = useState<string | null>(null);
  if (error || !meetings?.length) return <Section title="Календарь Outlook">
    <p role="status" className="t-body-m c-secondary">{error || (meetings ? "Встреч пока нет." : "Загрузка…")}</p></Section>;
  const now = Date.now();
  const minutes = selected ? Math.ceil((+new Date(selected.start) - now) / 60000) : 0;
  const when = minutes <= 0 ? "встреча идёт" : minutes <= 60 ? `через ${minutes} мин` : day.format(new Date(selected!.start));
  return <>
    {["Предстоящие", "Сейчас", "Прошедшие"].map((section, i) => {
      const rows = meetings.filter(m => !needsChoice(m) && (+new Date(m.end) <= now ? 2 : +new Date(m.start) > now ? 0 : 1) === i);
      if (i === 2) rows.reverse();
      return rows.length > 0 && <Section key={section} title={section}>{rows.map(m => (
        <ListRow key={cardKey(m)} title={m.title} subtitle={schedule(m)}
          status={m.choice ? [m.choice === "delegate" ? "идёт Vilar" : "лично", "Нейтрально", "Темная"] : undefined}
          onClick={() => select(cardKey(m))} />
      ))}</Section>;
    })}
    {selected && createPortal(
      protocolId === selected.id
        ? <div className="nested" role="dialog" aria-label="Протокол встречи"><MeetingProtocol title={selected.title} id={selected.id} schedule={schedule(selected)} onBack={() => setProtocolId(null)} /></div>
        : <SheetView key={cardKey(selected)} sheet={{
        title: selected.title,
        tags: [...schedule(selected).split(" · "), "Outlook"],
        status: needsChoice(selected) ? [when, "Внимание", "Яркая"] : undefined,
        msg: needsChoice(selected) ? "В приглашении есть ссылка на Телемост. Я могу пойти на встречу вместо вас. Кто пойдёт?" : undefined,
        actions: needsChoice(selected) && canEdit ? [["Поручить Vilar", "primary", "delegate"], ["Иду сам", "secondary", "personal"]]
          : [["Закрыть", "ghost", "close"]],
      }} onDecision={decide} onAction={() => select(null)}>
        {selected.can_reschedule && canEdit && <RescheduleMeeting key={selected.id} meeting={selected} save={reschedule} />}
        <BoardDocument kind="protocol" id={selected.id} />
        <button className="btn btn--secondary" onClick={() => setProtocolId(selected.id)}>Открыть протокол</button>
      </SheetView>,
      document.querySelector(".app")!,
    )}
  </>;
}

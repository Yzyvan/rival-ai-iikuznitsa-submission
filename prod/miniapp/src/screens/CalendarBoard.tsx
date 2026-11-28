import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchBoardData, canEdit } from "../api/mailBoard";
import { notifyAttention } from "../api/attention";
import { isoDay } from "../api/tracker";
import { Button, DraftCard, ListRow, Section, Toast } from "../ui";
import { BoardDocument } from "./BoardDocument";
import { MeetingProtocol } from "./Protocol";
import { SheetView } from "./SheetView";
import { PickDateSheet } from "./PickDateSheet";
import { FloatField } from "./NewTaskSheet";

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
    notifyAttention();
  };
  /** Перенос: POST ./api/calendar/board { id, start, end }. Длительность встречи сохраняется; время — московское */
  const reschedule = async (m: Meeting, date: Date, time: string) => {
    const start = new Date(`${isoDay(date)}T${time}:00+03:00`);
    const end = new Date(+start + Math.max(15 * 60000, +new Date(m.end) - +new Date(m.start)));
    const res = await fetchBoardData("./api/calendar/board", undefined, { id: m.id, start: start.toISOString(), end: end.toISOString() });
    if (res.status === 403) throw new Error("Для переноса откройте Vilar из Telegram владельца календаря.");
    if (res.status === 409) { reload(v => v + 1); throw new Error("Встреча изменилась. Проверьте обновлённое расписание."); }
    if (!res.ok) throw new Error("Не удалось перенести встречу. Попробуйте ещё раз.");
    setMeetings(current => current?.map(x => x.id === m.id ? {...x, start: start.toISOString(), end: end.toISOString()} : x) ?? null);
    reload(v => v + 1);
    notifyAttention();
  };
  const rescheduleOutlook = async (id: string, start: string, end: string, syncing: () => void) => {
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
  return { meetings, error, pending, select, selected, decide, reschedule, rescheduleOutlook };
}

/* ── Карточка встречи: GET ./api/calendar/detail?id=… — тема, время, участники и прошлая встреча, если она была ── */
type Person = string | { name?: string | null; email?: string | null };
type PreviousMeeting = { id?: string; title?: string | null; subject?: string | null; start?: string | null; summary?: string | null };
/** Ядро отдаёт attendees и previous_meeting, макетный сервер — participants и previous; принимаем оба */
type MeetingDetail = {
  participants?: Person[] | null;
  attendees?: Person[] | null;
  previous?: PreviousMeeting | null;
  previous_meeting?: PreviousMeeting | null;
};
const nameOf = (p: Person) => (typeof p === "string" ? p : p?.name || p?.email || "");

function useMeetingDetail(id: string) {
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchBoardData("./api/calendar/detail?" + new URLSearchParams({ id }), controller.signal)
      .then(async (res) => { if (res.ok) { const body = await res.json(); if (!controller.signal.aborted) setDetail(body?.meeting ?? body); } })
      .catch(() => { /* без подробностей карточка остаётся как в списке */ });
    return () => controller.abort();
  }, [id]);
  return detail;
}

/** Участники, прошлая встреча и уточнение участникам. Уточнение — учебный черновик: POST ./api/calendar/clarification { id, question } → черновик и адресаты */
function MeetingDetails({ meeting, canAsk }: { meeting: Meeting; canAsk: boolean }) {
  const detail = useMeetingDetail(meeting.id);
  const people = (detail?.participants ?? detail?.attendees ?? []).map(nameOf).filter(Boolean);
  const prev = detail?.previous ?? detail?.previous_meeting;
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ draft: string; recipients: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ask = async () => {
    if (busy || !question.trim()) return;
    setBusy(true); setError("");
    try {
      const res = await fetchBoardData("./api/calendar/clarification", undefined, { id: meeting.id, question: question.trim() });
      if (!res.ok) throw new Error(res.status === 403 ? "Уточнение готовит владелец календаря из Telegram." : "Не удалось подготовить уточнение.");
      const body = await res.json();
      setAnswer({ draft: String(body?.draft ?? body?.text ?? ""), recipients: (Array.isArray(body?.recipients) ? body.recipients : []).map(nameOf).filter(Boolean) });
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось подготовить уточнение."); }
    finally { setBusy(false); }
  };
  return <>
    {people.length > 0 && <div className="nt-section">
      <span className="t-overline c-tertiary">Участники</span>
      <p className="t-body-m">{people.join(", ")}</p>
    </div>}
    {prev && <div className="nt-section">
      <span className="t-overline c-tertiary">Прошлая встреча</span>
      <p className="t-body-m">{[prev.title ?? prev.subject, prev.start ? day.format(new Date(prev.start)) : null].filter(Boolean).join(" · ")}</p>
      {prev.summary && <p className="t-body-m c-secondary" style={{ whiteSpace: "pre-wrap" }}>{prev.summary}</p>}
    </div>}
    {canAsk && <div className="nt-section">
      <span className="t-overline c-tertiary">Уточнение участникам</span>
      {answer ? <>
        <DraftCard caption="Черновик уточнения" text={answer.draft} readOnly empty="Черновик пуст." />
        {answer.recipients.length > 0 && <p className="t-body-m c-secondary">Кому: {answer.recipients.join(", ")}</p>}
      </> : <>
        <FloatField label="Что уточнить" value={question} onChange={setQuestion} />
        <Button label={busy ? "Готовлю…" : "Подготовить уточнение"} variant="secondary" size="s" fill onClick={() => void ask()} />
      </>}
      {error && <p role="alert" className="t-body-m c-secondary">{error}</p>}
    </div>}
  </>;
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
    status={["кто пойдёт?", "Решение", "Яркая"]} onClick={() => select(m.id)} />)}</>;
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

export function CalendarBoard({ meetings, error, selected, select, decide, reschedule, rescheduleOutlook }: Calendar) {
  const [protocolId, setProtocolId] = useState<string | null>(null);
  const [moving, setMoving] = useState<Meeting | null>(null);   // «Перенести» — какую встречу
  const [note, setNote] = useState<{ text: string; key: number; ok?: boolean } | null>(null);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 2400); return () => clearTimeout(t); }, [note]);
  if (error || !meetings?.length) return <Section title="Календарь Outlook">
    <p role="status" className="t-body-m c-secondary">{error || (meetings ? "Встреч пока нет." : "Загрузка…")}</p></Section>;
  const now = Date.now();
  const minutes = selected ? Math.ceil((+new Date(selected.start) - now) / 60000) : 0;
  const when = minutes <= 0 ? "встреча идёт" : minutes <= 60 ? `через ${minutes} мин` : day.format(new Date(selected!.start));
  // переносить и уточнять можно встречу, которая ещё не закончилась
  const open = !!selected && canEdit && !selected.all_day && +new Date(selected.end) > now;
  const move: [string, "secondary", string][] = open && !selected.card_key ? [["Перенести", "secondary", "reschedule"]] : [];
  return <>
    {["Предстоящие", "Сейчас", "Прошедшие"].map((section, i) => {
      const rows = meetings.filter(m => !needsChoice(m) && (+new Date(m.end) <= now ? 2 : +new Date(m.start) > now ? 0 : 1) === i);
      if (i === 2) rows.reverse();
      return rows.length > 0 && <Section key={section} title={section}>{rows.map(m => (
        <ListRow key={cardKey(m)} title={m.title} subtitle={schedule(m)}
          status={m.choice ? [m.choice === "delegate" ? "идёт Vilar" : "лично", "Нейтрально", "Темная"] : undefined}
          onClick={() => select(m.id)} />
      ))}</Section>;
    })}
    {selected && createPortal(
      protocolId === selected.id
        ? <div className="nested" role="dialog" aria-label="Протокол встречи"><MeetingProtocol title={selected.title} id={selected.id} schedule={schedule(selected)} onBack={() => setProtocolId(null)} /></div>
        : <SheetView key={cardKey(selected)} sheet={{
        title: selected.title,
        tags: [...schedule(selected).split(" · "), "Outlook"],
        // ждёт решения — «через N мин» и вопрос; решение уже есть — кто идёт, и до начала встречи его можно поменять
        status: needsChoice(selected) ? [when, "Внимание", "Яркая"] : selected.choice ? [selected.choice === "delegate" ? "идёт Vilar" : "лично", "Нейтрально", "Темная"] : undefined,
        msg: needsChoice(selected) ? "В приглашении есть ссылка на Телемост. Я могу пойти на встречу вместо вас. Кто пойдёт?"
          : !selected.choice || +new Date(selected.start) <= now ? undefined
          : selected.choice === "delegate" ? "На эту встречу иду я вместо вас. Представлюсь ИИ-помощником, вопросы вне моих полномочий передам вам." : "На эту встречу вы идёте сами.",
        actions: needsChoice(selected) && canEdit ? [["Поручить Vilar", "primary", "delegate"], ["Иду сам", "secondary", "personal"], ...move]
          : selected.choice && +new Date(selected.start) > now && canEdit ? [[selected.choice === "delegate" ? "Пойду сам" : "Поручить Vilar", "secondary", selected.choice === "delegate" ? "personal" : "delegate"], ...move, ["Закрыть", "ghost", "close"]]
          : [...move, ["Закрыть", "ghost", "close"]],
      }} onDecision={decide} onAction={(to) => { if (to === "reschedule") setMoving(selected); select(null); }}>
        {open && selected.can_reschedule && <RescheduleMeeting key={selected.id} meeting={selected} save={rescheduleOutlook} />}
        <MeetingDetails meeting={selected} canAsk={open} />
        {/* протокол — только у встречи, которая уже началась: до неё показывать нечего */}
        {(selected.card_key || +new Date(selected.start) <= now) && <>
          <BoardDocument kind="protocol" id={selected.id} />
          <Button label="Открыть протокол" variant="secondary" fill onClick={() => setProtocolId(selected.id)} />
        </>}
      </SheetView>,
      document.querySelector(".app")!,
    )}
    {moving && createPortal(
      <PickDateSheet title="Перенести встречу" subtitle={moving.title} onClose={() => setMoving(null)}
        onPick={(date, time) => { const m = moving; setMoving(null); reschedule(m, date, time).then(() => setNote({ text: "Встреча перенесена", key: Date.now(), ok: true }), (e: Error) => setNote({ text: e.message, key: Date.now() })); }} />,
      document.querySelector(".app")!,
    )}
    {note && <Toast key={note.key} type={note.ok ? "Success" : "Error"} text={note.text} />}
  </>;
}

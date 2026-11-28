// Этап «Почта» на Доске: строки и шторка собираются из тикета mail (design/front-contract → actors-work.json).
// Какое поле в какой слот идёт — см. rowOf и sheetOf. Тег без значения не показывается, на его место ничего не встаёт.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { canEdit, hasAccountLaunch, fetchImportedMail, type ImportedMail } from "../api/mailBoard";
import { dayParam, frontAction, frontList, frontMailById, FrontError, isToday, NEEDS_REFRESH, whenLabel, type MailAction, type MailTicket } from "../api/front";
import { demoMail, DEMO_NOW } from "../data/mailTickets";
import type { SheetData } from "../data/sheets";
import { ListRow, Section, Toast, type StatusSpec } from "../ui";
import { onToastCommit, useNav } from "../nav";
import { BoardDocument, MailContent, handledByVilar, hasSentReply } from "./BoardDocument";
import { notifyAttention } from "../api/attention";
import { PreviewSheet, isPreview } from "./PreviewSheet";
import { QuarantineSheet, isQuarantine } from "./QuarantineSheet";
import { MailBoard } from "./MailBoard";
import { SheetView } from "./SheetView";

/* ── Данные ──
   demo   — без входа: макетные письма в формате договора;
   front  — после входа: GET /api/front/v1/mail?day=…;
   legacy — адреса договора на стенде ещё нет (404): действующий GET /api/mail/board, в нём только id, тема и день. */
type Mode = "demo" | "front" | "legacy";
type Store = { mode: Mode | null; tickets: MailTicket[] | null; legacy: ImportedMail[] | null; error: Error | null; note: { text: string; key: number } | null };
let store: Store = hasAccountLaunch ? { mode: null, tickets: null, legacy: null, error: null, note: null } : { mode: "demo", tickets: demoMail, legacy: null, error: null, note: null };
const subs = new Set<() => void>();
const set = (patch: Partial<Store>) => { store = { ...store, ...patch }; subs.forEach((f) => f()); };
const now = () => (hasAccountLaunch ? new Date() : DEMO_NOW);

let request: AbortController | null = null;
async function load() {
  if (!hasAccountLaunch) return;
  request?.abort();
  const controller = (request = new AbortController());
  try {
    const query = { day: dayParam(new Date()) };
    let page = await frontList<MailTicket>("mail", query, controller.signal);
    const items = [...page.items];
    for (let n = 1; page.next_cursor && n < 20; n++) {
      page = await frontList<MailTicket>("mail", { ...query, cursor: page.next_cursor }, controller.signal);
      items.push(...page.items);
    }
    set({ mode: "front", tickets: items, legacy: null, error: null });
  } catch (e) {
    if (controller.signal.aborted) return;
    if (e instanceof FrontError && e.status === 404) {
      try { set({ mode: "legacy", legacy: await fetchImportedMail(controller.signal), tickets: null, error: null }); }
      catch (err) { if (!controller.signal.aborted) set({ error: err as Error }); }
    } else set({ error: e as Error });
  }
}

const put = (t: MailTicket) => set({ tickets: (store.tickets ?? []).map((x) => (x.id === t.id ? t : x)) });
const fail = (e: unknown) => {
  set({ note: { text: e instanceof Error ? e.message : "Не удалось выполнить действие.", key: Date.now() } });
  if (e instanceof FrontError && NEEDS_REFRESH.has(e.code)) void load();
};

// В макете сервера нет: действие сразу даёт тот исход, который вернул бы сервер
const DEMO_RESULT: Partial<Record<MailAction, Partial<MailTicket>>> = {
  send_reply: { state: "sent", needs_user: false, actions: [] },
  reject: { state: "rejected", needs_user: false, actions: [] },
  no_reply: { state: "no_reply", needs_user: false, actions: [] },
};
/** Действие над письмом. Фронт передаёт версию, которую видел руководитель; в ответ приходит обновлённый тикет.
    Возвращает обновлённый тикет, а при отказе — ничего. */
async function act(t: MailTicket, action: MailAction, payload: object = {}): Promise<MailTicket | undefined> {
  let next: MailTicket;
  if (store.mode === "demo") next = { ...t, ...DEMO_RESULT[action], ...("text" in payload ? { draft: String(payload.text) } : {}), version: t.version + 1 };
  else try { next = await frontAction<MailTicket>(t, action, payload); } catch (e) { fail(e); return undefined; }
  put(next);
  if (store.mode !== "demo") notifyAttention();
  return next;
}

/** Письма этапа: что показать в шапке, в красных строках и в нижних разделах */
export function useMail() {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => store);
  useEffect(() => { void load(); }, []);
  const waiting = s.tickets?.filter((t) => t.needs_user && !isQuarantine(t)) ?? [];
  const quarantine = s.tickets?.filter(isQuarantine) ?? [];
  // «Vilar решил сам»: делегировал, сделал сам, положил в сводку. Пропущенные рассылки в список не идут.
  const handled = s.tickets?.filter((t) => !isQuarantine(t) && !t.needs_user && t.outcome !== "ask" && t.outcome !== "ignored") ?? [];
  // «Вы решили»: письма, по которым руководитель уже ответил, отказал или решил не отвечать
  const decided = s.tickets?.filter((t) => !isQuarantine(t) && !t.needs_user && t.outcome === "ask") ?? [];
  return {
    ...s, waiting, quarantine, handled, decided, refresh: load,
    /** сколько писем ждёт руководителя — в цвет фона Доски; пока не знаем — undefined */
    needs: s.tickets ? waiting.length : undefined,
    /** число на вкладке и в шапке этапа */
    shown: s.tickets ? waiting.length + quarantine.length + handled.length : s.legacy?.length,
  };
}
export type Mail = ReturnType<typeof useMail>;

/* ── Слоты ── */
const OUTCOME: Record<string, StatusSpec> = {
  delegated: ["делегировано", "Нейтрально", "Темная"], auto: ["согласовано", "Готово", "Яркая"],
  digest: ["в сводке", "Нейтрально", "Темная"], ignored: ["пропущено", "Нейтрально", "Темная"],
};
const ASK_STATE: Record<string, StatusSpec> = {
  cancelled_preview: ["решение отменено", "Нейтрально", "Темная"],
  accepted: ["Outlook принял письмо", "Готово", "Яркая"],
  confirming: ["ожидает отправки", "Внимание", "Яркая"],
  queued: ["в очереди на отправку", "Нейтрально", "Темная"],
  approved_preview: ["черновик подтвержден", "Готово", "Яркая"],
  sending: ["отправляю", "Нейтрально", "Темная"], sent: ["отправлено", "Готово", "Яркая"], failed: ["не отправлено", "Проблема", "Темная"],
  unknown: ["требует сверки", "Внимание", "Яркая"], rejected: ["отклонено", "Нейтрально", "Темная"], no_reply: ["без ответа", "Нейтрально", "Темная"],
};
/** Плашка — всегда состояние: «решение» / срок ответа у ждущего письма, исход у решённого без руководителя */
function statusOf(t: MailTicket, waitingLabel: string): StatusSpec {
  if (isQuarantine(t)) return ["карантин", "Внимание", "Яркая"];
  if (t.outcome !== "ask") return OUTCOME[t.outcome];
  if (t.state === "waiting") return t.answer_by && isToday(t.answer_by, now()) ? ["ответ сегодня", "Внимание", "Яркая"] : [waitingLabel, "Решение", "Яркая"];
  return ASK_STATE[t.state] ?? [waitingLabel, "Решение", "Яркая"];
}
const tags = (items: (string | null | undefined)[]) => items.filter((x): x is string => !!x);
/** Заголовок: сжатый смысл от нейронки; пока письмо не обработано — тема как у отправителя */
const titleOf = (t: MailTicket) => t.title ?? t.subject ?? "Письмо без темы";

/** Строка на Доске.
    ждёт решения:   заголовок title · тег 1 from.name · тег 2 topic · плашка «решение» или «ответ сегодня»
    Vilar решил сам: заголовок title · тег 1 done (если его нет — from.name и topic) · плашка — исход */
function rowOf(t: MailTicket) {
  const subtitle = t.needs_user || !t.done ? tags([t.from?.name, t.topic]) : [t.done];
  return { title: titleOf(t), subtitle: subtitle.join(" · ") || undefined, status: statusOf(t, "решение") };
}

const BUTTON: Record<string, [label: string, style: "primary" | "secondary", toast: string]> = {
  approve_preview: ["Подтвердить черновик", "primary", "t4"],
  send_reply: ["Отправить ответ", "primary", "t2"], reject: ["Отклонить", "secondary", "t3"],
  no_reply: ["Не отвечать", "secondary", "t17"], remind: ["Напомнить", "secondary", "t4"],
};
const SOURCE: Record<string, string> = { mail: "почта", chat: "чат", meeting: "встреча", calendar: "календарь" };
/** Шторка.
    плашка — состояние · заголовок title · тег 1 from.name · тег 2 откуда (source.kind, только у ждущего) · тег 3 когда пришло (received_at)
    текст — summary · черновик — draft · кнопки — только те действия, что есть в actions */
function sheetOf(t: MailTicket): SheetData {
  const when = t.received_at ? whenLabel(t.received_at, now()) : null;
  // «Отправить ответ» — только когда есть что отправлять: без черновика кнопки нет, даже если сервер её разрешил
  const decided = (["approve_preview", "send_reply", "reject", "no_reply", "remind"] as const).filter((a) => t.actions.includes(a) && !(a === "send_reply" && !t.draft));
  const actions: SheetData["actions"] = decided.map((a) => [BUTTON[a][0], BUTTON[a][1], a]);
  // у письма без кнопки решения и у решённого без руководителя — «Закрыть»
  if (!t.needs_user || !actions.length) actions.push(["Закрыть", "ghost", "close"]);
  return {
    status: statusOf(t, "ваше решение"), title: titleOf(t),
    tags: t.needs_user ? tags([t.from?.name, SOURCE[t.source.kind], when]) : tags([t.from?.name, when]),
    msg: t.summary ?? undefined,
    // черновик показываем, пока ответ ждёт решения или ушёл; у отклонённого и оставленного без ответа письма его нет
    draft: t.state === "rejected" || t.state === "no_reply" ? undefined : t.draft ?? undefined, actions,
  };
}

/** Черновик есть, а отправить нельзя: сервер не дал send_reply (адрес ответа не подтверждён). Человеку нужно сказать почему. */
const cannotSend = (t: MailTicket) => t.state === "waiting" && !!t.draft && !t.actions.includes("send_reply") && !t.actions.includes("approve_preview");

/* ── Экран ── */
/** Красные строки шапки: письма, которые ждут руководителя */
export function MailUrgent({ mail, onOpen }: { mail: Mail; onOpen: (id: string) => void }) {
  return <>{mail.waiting.map((t) => <ListRow key={t.id} urgent {...rowOf(t)} onClick={() => onOpen(t.id)} />)}</>;
}

/** Нижняя часть этапа: «Vilar решил сам» и шторка письма */
export function MailSections({ mail, opened, onOpen }: { mail: Mail; opened: string | null; onOpen: (id: string | null) => void }) {
  const nav = useNav();
  const dayTicket = mail.tickets?.find((t) => t.id === opened);
  const [linked, setLinked] = useState<{ cycle: number; ticket: MailTicket } | null>(null);
  const openCycle = useRef(0);
  const selectMail = (id: string | null) => {
    openCycle.current += 1;
    setLinked(null);
    onOpen(id);
  };
  const detail = linked?.cycle === openCycle.current && linked.ticket.id === opened ? linked.ticket : undefined;
  const ticket = detail && (!dayTicket || detail.version >= dayTicket.version) ? detail : dayTicket;
  const refreshDetail = (result: MailTicket, cycle = openCycle.current) => {
    if (cycle !== openCycle.current) return;
    setLinked((current) => current?.cycle === cycle && current.ticket.id === result.id
      && current.ticket.version > result.version ? current : { cycle, ticket: result });
    const existing = store.tickets?.find((item) => item.id === result.id);
    if (existing && (existing.version < result.version || (existing.version === result.version && existing.state !== result.state))) {
      const { plain_text: _plainText, ...summary } = result;
      put(summary);
    }
  };
  const poll = !dayTicket || isQuarantine(dayTicket) || isPreview(dayTicket) || dayTicket.state === "sending" || dayTicket.state === "unknown";
  useEffect(() => {
    if (!hasAccountLaunch || !opened || !poll) return;
    const controller = new AbortController();
    const cycle = openCycle.current;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await frontMailById(opened, controller.signal);
        if (!controller.signal.aborted) refreshDetail(result, cycle);
      } catch (e) {
        if (!controller.signal.aborted && cycle === openCycle.current) {
          if (e instanceof FrontError && [401, 403, 404].includes(e.status)) {
            selectMail(null);
          }
          fail(e);
        }
      } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2500);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [opened, poll]);
  const [missingDocument, setMissingDocument] = useState<string | null>(null);
  const [deniedDocument, setDeniedDocument] = useState<string | null>(null);
  const useOwnerDocument = hasAccountLaunch && ticket?.id !== missingDocument;
  const [draft, setDraft] = useState<string | null>(null);   // правка черновика, пока шторка открыта
  const saving = useRef<Promise<MailTicket | undefined> | null>(null);   // сохранение правки, которое ещё идёт
  useEffect(() => { setDraft(null); setMissingDocument(null); setDeniedDocument(null); saving.current = null; }, [opened]);
  useEffect(() => { if (!mail.note) return; const t = setTimeout(() => set({ note: null }), 2400); return () => clearTimeout(t); }, [mail.note]);

  // решение уходит на сервер, только когда тост с отменой досчитал до конца
  const decide = (t: MailTicket, to: string) => {
    selectMail(null);
    if (to === "close") return;
    const action = to as MailAction;
    const payload = action === "send_reply" ? { text: draft ?? t.draft ?? "" } : action === "remind" ? { person_id: t.delegated_to?.id ?? null } : {};
    // Версия — та, что была на экране в момент нажатия (с учётом собственной правки черновика, если она ещё сохраняется).
    // Если за время отсчёта карточку изменил кто-то ещё, сервер отклонит устаревшее подтверждение.
    const seen = saving.current ? saving.current.then((saved) => saved ?? t) : Promise.resolve(t);
    onToastCommit(() => void seen.then((card) => act(card, action, payload)));
    nav("toast:" + BUTTON[action][2]);
  };

  const deliveredByVilar = handledByVilar(ticket) && hasSentReply(ticket);
  const preview = ticket && isPreview(ticket) && !(deliveredByVilar && ticket.state === "accepted");
  const content = ticket && (useOwnerDocument
    ? <BoardDocument kind="mail" id={ticket.id} ticket={ticket} contentOnly={!!preview}
        onText={preview ? undefined : setDraft} onMissing={setMissingDocument} onDenied={setDeniedDocument} />
    : <MailContent ticket={ticket} />);
  const sheet = ticket && sheetOf(ticket);
  if (ticket && sheet) {
    sheet.msg = undefined; // MailContent renders the summary together with the original.
    if (useOwnerDocument || deliveredByVilar) sheet.draft = undefined;
    if (ticket.id === deniedDocument || (hasAccountLaunch && !canEdit)) sheet.actions = [["Закрыть", "ghost", "close"]];
  }

  return <>
    {mail.mode === "legacy"
      ? <MailBoard mail={{ messages: mail.legacy, error: mail.error, refresh: () => void mail.refresh() }} />
      : <>
        {mail.error && <Section title="Почта"><p role="alert" className="t-body-m c-secondary">{mail.error.message}</p></Section>}
        {!mail.error && !mail.tickets && <Section title="Почта"><p role="status" className="t-body-m c-secondary">Загрузка…</p></Section>}
        {mail.quarantine.length > 0 && <Section title="Карантин">
          {mail.quarantine.map((t) => <ListRow key={t.id} {...rowOf(t)} onClick={() => selectMail(t.id)} />)}
        </Section>}
        {mail.handled.length > 0 && <Section title="Vilar решил сам" vilar>
          {mail.handled.map((t) => <ListRow key={t.id} {...rowOf(t)} onClick={() => selectMail(t.id)} />)}
        </Section>}
        {mail.decided.length > 0 && <Section title="Вы решили">
          {mail.decided.map((t) => <ListRow key={t.id} {...rowOf(t)} onClick={() => selectMail(t.id)} />)}
        </Section>}
      </>}
    {mail.note && <Toast key={mail.note.key} type="Error" text={mail.note.text} />}
    {ticket && sheet && createPortal(
      isQuarantine(ticket) ? <QuarantineSheet key={ticket.id} ticket={detail ?? ticket} sheet={sheetOf(ticket)}
        detailReady={Boolean(detail)} onUpdate={refreshDetail} onClose={() => selectMail(null)} /> :
      preview ? <PreviewSheet key={ticket.id} denied={ticket.id === deniedDocument} ticket={ticket} sheet={sheet} onUpdate={refreshDetail} onClose={() => selectMail(null)}>{content}</PreviewSheet> : <SheetView key={ticket.id} sheet={sheet} onAction={(to) => decide(ticket, to)}
        draftReadOnly={(hasAccountLaunch && !canEdit) || !ticket.actions.includes("edit_reply")}
        draftCaption={ticket.state === "sent" ? "Отправлено от вашего имени" : ticket.state === "sending" ? "Отправляется от вашего имени" : cannotSend(ticket) || ticket.actions.includes("approve_preview") || ticket.state === "approved_preview" ? "Черновик ответа" : "Черновик ответа в Vilar"}
        note={ticket.actions.includes("approve_preview") || ticket.state === "approved_preview" ? "Отправка отключена на время проверки." : cannotSend(ticket) ? "отправить пока не могу: адрес ответа не подтверждён" : undefined}
        onDraft={(text) => {
          setDraft(text);
          const cycle = openCycle.current;
          saving.current = act(ticket, "edit_reply", { text }).then(updated => {
            if (updated) refreshDetail(updated, cycle);
            return updated;
          });
        }}>
        {content}
      </SheetView>,
      document.querySelector(".app")!,
    )}
  </>;
}

/** Подпись под большой цифрой: «3 решения ждут вас сегодня» */
export const mailHeroLabel = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "решение ждёт вас сегодня" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "решения ждут вас сегодня" : "решений ждут вас сегодня");

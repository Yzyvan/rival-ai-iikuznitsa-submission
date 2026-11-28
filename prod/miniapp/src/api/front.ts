// Договор фронта и сервера: design/front-contract (README.md, common.json, actors-work.json …).
// Тикеты читаются и меняются по адресам /api/front/v1. На стенде этих адресов пока нет — см. useMail в screens/MailStage.tsx,
// там же запасной путь на действующий GET /api/mail/board.
import { launchHeaders } from "./mailBoard";

export const FRONT = "./api/front/v1";

/** Человек в тикете: имя и фамилия полностью; для внешнего автора id может быть null */
export type PersonRef = { id: string | null; name: string | null; email?: string | null; role?: string | null };

/** Поля, общие для всех тикетов (common.json) */
export type Ticket = {
  id: string; type: string; profile_id: string; version: number;
  created_at: string | null; updated_at: string | null;
  /** сжатый смысл для строки и шторки; до обработки письма — null, тогда показываем тему */
  title: string | null;
  /** объяснение от Vilar в шторке */
  summary: string | null;
  /** ждёт действия руководителя: красная карточка, входит в большую цифру и в цвет фона */
  needs_user: boolean | null;
  state: string | null;
  /** какие кнопки показать сейчас */
  actions: string[];
  source: { kind: "mail" | "meeting" | "chat" | "calendar" | "manual" | "task" | "directory"; id: string | null; at?: string | null; quote?: string | null; time?: string | null };
};

export type MailState = "accepted" | "confirming" | "queued" | "waiting" | "sending" | "sent" | "failed" | "unknown" | "rejected" | "no_reply" | "done" | "approved_preview" | "cancelled_preview";
export type MailOutcome = "ask" | "delegated" | "auto" | "digest" | "ignored";
export type QuarantineAction = "preview_quarantine" | "confirm_sender" | "keep_quarantine" | "undo_quarantine";
export type QuarantineInfo = {
  folder?: "inbox" | "junkemail" | null;
  mailbox?: string | null; received_at?: string | null; sender?: string | null;
  reason?: string | null; receipt?: string | null;
  has_subject?: boolean | null; has_text?: boolean | null; has_attachments?: boolean | null;
};
export type MailAction = "start_confirmation" | "cancel_confirmation" | "reopen_preview" | "edit_preview" | "cancel_preview" | "approve_preview" | "send_reply" | "edit_reply" | "reject" | "no_reply" | "remind" | QuarantineAction;

/** Письмо и решение по нему (actors-work.json → types.mail) */
export type MailTicket = Ticket & {
  type: "mail"; confirmation_deadline?: string | null; state: MailState; actions: MailAction[];
  from: PersonRef | null;
  arrival_status?: "ordinary" | "unknown_sender" | "junk" | "security_hold";
  arrival_info?: QuarantineInfo;
  quarantine_state?: "waiting" | "confirming" | "held" | "confirmed";
  preview_status?: "not_requested" | "pending" | "clear" | "blocked" | "unavailable";
  plain_text?: string | null;
  /** тема как у отправителя; в заголовок идёт, только пока нет title */
  subject: string | null;
  /** область вопроса в 1–2 слова — второй тег строки */
  topic: string | null;
  /** главная фраза письма дословно */
  quote: string | null;
  received_at: string | null;
  thread_count: number | null;
  outcome: MailOutcome;
  /** какое правило профиля сработало; только для outcome = ask */
  category: "money" | "hr" | "client_commitment" | "leadership" | "other" | null;
  reason: string | null;
  /** черновик ответа от первого лица руководителя */
  draft: string | null;
  /** подтверждённый адресат ответа */
  reply_to: PersonRef | null;
  answer_by: string | null;
  delegated_to: { id: string; name: string } | null;
  task_id: string | null;
  /** что сделал Vilar: «передал Ольге» */
  done: string | null;
  receipt: { state: "sent" | "failed" | "unknown"; at: string | null; provider_id: string | null } | null;
  amount: { value: number; currency: string } | null;
};

/** Отказ сервера: { error: { code, message } } */
export class FrontError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// Что видит человек при отказе (README: таблица «HTTP → что делает экран»)
const REFUSAL: Record<string, string> = {
  unauthenticated: "Откройте Vilar заново из Telegram.",
  forbidden: "Нет доступа.",
  not_found: "Карточка больше недоступна.",
  stale_version: "Карточка обновилась — показываю свежую.",
  action_unavailable: "Действие сейчас недоступно.",
  idempotency_conflict: "Это действие уже учтено — сверяю результат.",
  result_unknown: "Требует сверки: жду подтверждения отправки.",
  invalid_payload: "Проверьте введённые данные.",
};
/** Отказы, после которых карточку нужно перечитать */
export const NEEDS_REFRESH = new Set(["stale_version", "action_unavailable", "idempotency_conflict", "result_unknown", "not_found"]);

async function refusal(res: Response): Promise<FrontError> {
  let code = "", message = "";
  try { const body = await res.json(); code = body?.error?.code ?? ""; message = body?.error?.message ?? ""; } catch { /* тело не JSON */ }
  return new FrontError(res.status, code, REFUSAL[code] ?? message ?? "Не удалось выполнить действие.");
}

/** Список тикетов: GET /api/front/v1/{type} → { items, next_cursor } */
export async function frontList<T>(type: string, query: Record<string, string>, signal?: AbortSignal): Promise<{ items: T[]; next_cursor: string | null }> {
  const res = await fetch(`${FRONT}/${type}?${new URLSearchParams(query)}`, { headers: launchHeaders(), cache: "no-store", redirect: "error", signal });
  if (!res.ok) throw await refusal(res);
  return res.json();
}

export async function frontMailById(id: string, signal?: AbortSignal): Promise<MailTicket> {
  const res = await fetch(`${FRONT}/mail/${encodeURIComponent(id)}`, {
    headers: launchHeaders(), cache: "no-store", redirect: "error", signal,
  });
  if (!res.ok) throw await refusal(res);
  const value = await res.json() as MailTicket;
  if (value.type !== "mail" || value.id !== id) throw new FrontError(502, "", "Карточка недоступна.");
  return value;
}

const newKey = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));

/** Действие над тикетом: POST /api/front/v1/{type}/{id}/actions/{action}, тело { version, payload }, заголовок Idempotency-Key.
    В ответ — обновлённый тикет. version — та, которую руководитель видел на экране. */
export async function frontAction<T>(ticket: Pick<Ticket, "type" | "id" | "version">, action: string, payload: object = {}, key = newKey()): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${FRONT}/${ticket.type}/${encodeURIComponent(ticket.id)}/actions/${action}`, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { ...launchHeaders(), "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ version: ticket.version, payload }),
    });
  } catch {
    // ответа нет — исход неизвестен: повторять нельзя, пока не сверим
    throw new FrontError(0, "result_unknown", REFUSAL.result_unknown);
  }
  if (!res.ok) throw await refusal(res);
  return res.json();
}

/* ── Слова из машинных значений: их делает фронт ── */
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const ZONE = "Europe/Moscow";   // часовой пояс профиля; придёт в profile.rhythm.timezone
const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("ru-RU", { timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]));
const dayNumber = (d: Date) => { const p = parts(d); return Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000); };
/** «сегодня, 09:12» · «вчера, 16:39» · «7 дек, 08:38» */
export function whenLabel(iso: string, now: Date) {
  const d = new Date(iso), p = parts(d), diff = dayNumber(now) - dayNumber(d);
  const day = diff === 0 ? "сегодня" : diff === 1 ? "вчера" : `${+p.day} ${MONTHS_SHORT[+p.month - 1]}`;
  return `${day}, ${p.hour}:${p.minute}`;
}
/** Тот же день, что и сейчас (в поясе профиля) */
export const isToday = (iso: string, now: Date) => dayNumber(new Date(iso)) === dayNumber(now);
/** День для запроса списка: 2026-12-08 */
export const dayParam = (now: Date) => { const p = parts(now); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; };

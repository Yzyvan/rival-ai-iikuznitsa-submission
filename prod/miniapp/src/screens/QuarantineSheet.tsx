import { useRef, useState } from "react";
import { frontAction, frontMailById, FrontError, type MailTicket, type QuarantineAction } from "../api/front";
import type { SheetData } from "../data/sheets";
import { Button } from "../ui";
import { SheetView } from "./SheetView";

const labels: Record<QuarantineAction, string> = {
  preview_quarantine: "Открыть текст",
  confirm_sender: "Подтвердить адрес",
  keep_quarantine: "Оставить в карантине",
  undo_quarantine: "Отменить решение",
};

const decisions = ["confirm_sender", "keep_quarantine", "undo_quarantine"] as const;
const stateLabels = {
  waiting: "Письмо ждет решения.",
  confirming: "Подтверждение адреса можно отменить.",
  held: "Письмо оставлено в карантине.",
  confirmed: "Адрес подтвержден.",
};

const previewLabels = {
  not_requested: "",
  pending: "Текст проходит проверку безопасности.",
  clear: "",
  blocked: "Проверка безопасности остановила просмотр.",
  unavailable: "Текст пока недоступен.",
};

export const isQuarantine = (ticket: MailTicket) => Boolean(ticket.quarantine_state
  || ticket.arrival_status === "unknown_sender" || ticket.arrival_status === "junk");

const presence = (value: boolean | null | undefined) =>
  value === true ? "Есть" : value === false ? "Нет" : "Не проверено";

function timeLabel(value?: string | null) {
  if (!value) return null;
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
  }).format(time) + " МСК";
}

export function QuarantineSheet({ ticket, sheet, detailReady, onUpdate, onClose }: {
  ticket: MailTicket; sheet: SheetData; detailReady: boolean; onUpdate: (value: MailTicket) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const info = ticket.arrival_info;
  const status = ticket.preview_status ?? "not_requested";
  const folder = info?.folder === "inbox" ? "Входящие"
    : info?.folder === "junkemail" ? "Нежелательная почта" : null;
  const rows: [string, string | null | undefined][] = [
    ["Отправитель", info?.sender],
    ["Ящик", info?.mailbox],
    ["Папка", folder],
    ["Получено", timeLabel(info?.received_at ?? ticket.received_at)],
    ["Тема", presence(info?.has_subject)],
    ["Текст", presence(detailReady && status === "clear" && typeof ticket.plain_text === "string"
      ? Boolean(ticket.plain_text.trim()) : info?.has_text)],
    ["Вложения", presence(info?.has_attachments)],
    ["Квитанция", info?.receipt],
  ];

  const act = async (action: QuarantineAction) => {
    if (!detailReady || locked.current || !ticket.actions.includes(action)) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const changed = await frontAction<MailTicket>(ticket, action);
      if (changed.type !== "mail" || changed.id !== ticket.id) throw new Error("Карточка недоступна.");
      onUpdate(changed);
    } catch (e) {
      setError(e instanceof FrontError && e.status === 409
        ? "Карточка обновилась. Проверьте текущее решение."
        : "Не удалось выполнить действие. Проверьте состояние письма.");
      try { onUpdate(await frontMailById(ticket.id)); } catch { /* сохранить сообщение об ошибке */ }
    } finally {
      setBusy(false);
      locked.current = false;
    }
  };

  return (
    <SheetView sheet={{ ...sheet, title: "Письмо в карантине", status: undefined, tags: undefined, draft: undefined, msg: undefined, actions: [] }}
      onAction={() => { if (!locked.current) onClose(); }}>
      {ticket.quarantine_state && <p className="t-body-l" role="status">{stateLabels[ticket.quarantine_state]}</p>}
      {info && <dl className="quarantine-sheet__meta t-body-m">
        {rows.map(([label, value]) => value && <div key={label}
          className={label === "Квитанция" ? "quarantine-sheet__receipt" : undefined}>
          <dt>{label}</dt><dd>{value}</dd>
        </div>)}
      </dl>}
      {previewLabels[status] && <p className="t-body-l" role="status">{previewLabels[status]}</p>}
      {detailReady && status === "clear" && typeof ticket.plain_text === "string" && (
        <section aria-label="Текст письма">
          <h3 className="t-title-m">Текст письма</h3>
          <p className="quarantine-sheet__text t-body-l">{ticket.plain_text || "Письмо без текста."}</p>
        </section>
      )}
      {error && <p className="t-body-l" role="alert">{error}</p>}
      <div className="sheet__actions" aria-busy={busy}>
        {detailReady && ticket.actions.includes("preview_quarantine") &&
          <Button label={labels.preview_quarantine} variant="secondary" fill disabled={busy}
            onClick={() => void act("preview_quarantine")} />}
        {detailReady && decisions.filter(action => ticket.actions.includes(action)).map(action =>
          <Button key={action} label={labels[action]} variant={action === "confirm_sender" ? "primary" : "secondary"}
            fill disabled={busy} onClick={() => void act(action)} />)}
        <Button label="Закрыть" variant="ghost" fill disabled={busy} onClick={onClose} />
      </div>
    </SheetView>
  );
}

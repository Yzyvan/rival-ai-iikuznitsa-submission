import { useEffect, useState } from "react";
import { BoardAccessError, canEdit, fetchBoardData } from "../api/mailBoard";
import { notifyAttention } from "../api/attention";
import type { MailTicket } from "../api/front";
import { Button, DraftCard, IncomingMessage, VilarHint, VilarMessage } from "../ui";

/** GET ./api/owner/document?kind=…&id=…: text — черновик, body — само письмо; recommendation = no_reply — отвечать не нужно */
type Document = { text: string; version: string; body?: string | null; webLink?: string | null; recommendation?: string | null };

export function handledByVilar(ticket?: MailTicket) {
  return !!ticket && !ticket.needs_user && ticket.outcome !== "ask";
}

export function hasSentReply(ticket?: MailTicket) {
  if (!ticket) return false;
  return ticket.receipt ? ticket.receipt.state === "sent" : ticket.state === "sent" || ticket.state === "accepted";
}

/** A saved owner document is editable. Only the ticket can confirm delivery. */
export function MailContent({ ticket, body, recommendation }: { ticket?: MailTicket; body?: string | null; recommendation?: string | null }) {
  const summary = ticket?.summary?.trim();
  const original = body === undefined ? ticket?.quote : body === null
    ? "В архивной записи сохранилась только тема письма." : body || "Письмо без текста.";
  const conversation = handledByVilar(ticket);
  const incoming = summary || original;
  const sent = hasSentReply(ticket);
  let result = ticket?.done?.trim();
  if (ticket && conversation && !result) {
    if (ticket.outcome === "delegated") result = ticket.delegated_to?.name ? `Передано: ${ticket.delegated_to.name}` : "Поручение делегировано.";
    else if (ticket.state === "no_reply" || recommendation === "no_reply") result = "Ответ не требуется.";
    else if (ticket.outcome === "digest") result = "Письмо добавлено в сводку.";
    else if (ticket.outcome === "auto") result = "Согласовано автоматически.";
  }
  return <div className={conversation ? "chat" : "stack"}>
    {incoming && (conversation ? <IncomingMessage name={ticket?.from?.name} text={incoming} />
      : summary ? <VilarMessage text={summary} /> : <p className="mail-original">{incoming}</p>)}
    {summary && original && <details className="mail-original">
      <summary>{body == null ? "Исходное письмо" : "Полный текст письма"}</summary>
      <p>{original}</p>
    </details>}
    {conversation && sent && <VilarMessage side="right" caption="Vilar ответил" text={ticket?.draft?.trim() || "Отправка подтверждена."} />}
    {conversation && result && (!sent || ticket?.outcome === "delegated") && <VilarMessage side="right" text={result} />}
  </div>;
}

export function BoardDocument({ kind, id, onText, onMissing, onDenied, ticket, contentOnly }: {
  kind: "mail" | "protocol"; id: string; ticket?: MailTicket; contentOnly?: boolean;
  onText?: (text: string) => void; onMissing?: (id: string) => void; onDenied?: (id: string | null) => void;
}) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [message, inform] = useState("");
  const [saving, save] = useState(false);
  const [reload, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchBoardData("./api/owner/document?" + new URLSearchParams({ kind, id }), controller.signal)
      .then(async (response) => {
        if (response.status === 404) {
          if (!controller.signal.aborted) onMissing?.(id);
          throw Error("Запись больше недоступна.");
        }
        if (response.status === 403) throw new BoardAccessError("Документ недоступен.");
        if (!response.ok) throw Error("Документ недоступен.");
        const data: Document = await response.json();
        if (!controller.signal.aborted) { setDoc(data); onDenied?.(null); inform(""); onText?.(data.text ?? ""); }
      }).catch((e) => {
        if (controller.signal.aborted) return;
        setDoc(null);
        if (e instanceof BoardAccessError) onDenied?.(id);
        inform(e.message);
      });
    return () => controller.abort();
  }, [kind, id, reload, onMissing, onDenied, onText]);
  async function persist(text: string) {
    if (!canEdit || !doc || saving) return;
    save(true);
    try {
      const res = await fetchBoardData("./api/owner/document", undefined, { kind, id, text, version: doc.version });
      if (res.status === 403) throw new BoardAccessError("Документ недоступен.");
      if (!res.ok) throw Error(res.status === 409 ? "Документ изменился. Скопируйте свои правки и загрузите актуальную версию." : "Не удалось сохранить.");
      refresh((n) => n + 1);
      notifyAttention();
    } catch (e) {
      if (e instanceof BoardAccessError) { setDoc(null); onDenied?.(id); }
      inform(e instanceof Error ? e.message : "Ошибка сохранения.");
    }
    finally { save(false); }
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      {doc && kind === "mail" && <MailContent ticket={ticket} body={doc.body} recommendation={doc.recommendation} />}
      {doc?.webLink?.startsWith("https://outlook.") && <a className="btn btn--secondary btn--s btn--fill" style={{ textDecoration: "none" }} href={doc.webLink} target="_blank" rel="noreferrer">Открыть письмо в Outlook</a>}
      {kind === "mail" && !handledByVilar(ticket) && doc?.recommendation === "no_reply" && <VilarHint text="Ответ не требуется" />}
      {doc && !contentOnly && (!handledByVilar(ticket) || (!!doc.text?.trim() && !hasSentReply(ticket))) && <DraftCard key={doc.version} caption={kind === "mail" ? "Черновик ответа в Vilar" : "Протокол встречи"} text={doc.text} readOnly={!canEdit}
        empty={kind === "mail" ? "Черновик пока пуст." : "Протокол пока не создан."} onSave={(text) => void persist(text)} />}
      {!doc && !message && <p role="status" className="t-body-m c-secondary">Загрузка…</p>}
      {saving && <p role="status" className="t-body-m c-secondary">Сохраняю…</p>}
      {message && <>
        <p role="status" className="t-body-m c-secondary">{message}</p>
        <Button label="Загрузить заново" variant="secondary" size="s" fill onClick={() => refresh((n) => n + 1)} />
      </>}
    </div>
  );
}

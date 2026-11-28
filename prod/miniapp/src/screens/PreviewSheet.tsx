import { useEffect, useRef, useState } from "react";
import { frontAction, frontMailById, FrontError, type MailTicket } from "../api/front";
import type { SheetData } from "../data/sheets";
import { Button, DraftCard, Icon } from "../ui";
import { tick } from "../haptics";
import { SheetView } from "./SheetView";

type Action = "start_confirmation" | "cancel_confirmation" | "approve_preview" | "edit_preview" | "cancel_preview" | "reopen_preview";
const labels: Record<Action, string> = { start_confirmation: "Подтвердить", cancel_confirmation: "Отменить подтверждение", approve_preview: "Подтвердить", edit_preview: "Редактировать", cancel_preview: "Отклонить", reopen_preview: "Вернуть на согласование" };
const actions = Object.keys(labels) as Action[];
export const isPreview = (ticket: MailTicket) =>
  ticket.state === "accepted" || ticket.state === "confirming" || ticket.state === "queued" || ticket.state === "approved_preview" || ticket.state === "cancelled_preview" || actions.some(action => ticket.actions.includes(action));

export function PreviewSheet({ ticket, sheet, onUpdate, onClose }: {
  ticket: MailTicket; sheet: SheetData; onUpdate: (value: MailTicket) => void; onClose: () => void;
}) {
  const [edit, setEdit] = useState<{ version: number; text: string } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("edit") === "1" && params.get("open") === "mail:" + ticket.id && ticket.actions.includes("edit_preview")
      ? { version: ticket.version, text: ticket.draft ?? "" } : null;
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("edit") === "1" && url.searchParams.get("open") === "mail:" + ticket.id) {
      url.searchParams.delete("edit");
      window.history.replaceState(window.history.state, "", url);
    }
  }, [ticket.id]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const stale = edit !== null && edit.version !== ticket.version;
  const save = async (action: Action) => {
    if (locked.current || !ticket.actions.includes(action) || (action === "edit_preview" && (!edit || stale || !edit.text.trim()))) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const changed = await frontAction<MailTicket>(ticket, action, action === "edit_preview" ? { text: edit!.text.trim() } : {});
      onUpdate(changed);
      setEdit(null);
    } catch (e) {
      setError(e instanceof FrontError && e.status === 409 ? "Карточка изменилась. Проверьте текущую версию." : e instanceof Error ? e.message : "Не удалось сохранить решение.");
    } finally {
      try { onUpdate(await frontMailById(ticket.id)); }
      catch { setError("Не удалось сверить версию. Откройте карточку еще раз."); }
      locked.current = false;
      setBusy(false);
    }
  };
  const begin = () => { setEdit({ version: ticket.version, text: ticket.draft ?? "" }); setError(""); };
  if (edit) return <section className="preview-editor" role="dialog" aria-modal="true" aria-labelledby="preview-editor-title">
    <header><h2 id="preview-editor-title" className="t-title-m">Редактировать черновик</h2></header>
    <textarea aria-label="Текст черновика" className="preview-editor__input t-body-l" autoFocus value={edit.text}
      disabled={busy} onChange={e => setEdit({ ...edit, text: e.target.value })} />
    {stale && <p role="status" className="t-body-m">Карточка изменилась. Скопируйте свои правки и откройте редактор заново.</p>}
    {error && <p role="alert" className="t-body-m">{error}</p>}
    <div className="sheet__actions">
      <Button label="Сохранить правку" variant="primary" fill disabled={busy || stale || !edit.text.trim()} onClick={() => void save("edit_preview")} />
      <Button label="Отменить правку" variant="secondary" fill disabled={busy} onClick={() => { setEdit(null); setError(""); }} />
    </div>
  </section>;
  return <>
    <SheetView sheet={{ ...sheet, draft: undefined, msg: undefined, actions: [] }} onAction={onClose}>
      {sheet.msg && <p className="t-body-l">{sheet.msg}</p>}
      <DraftCard key={ticket.version} caption="Черновик ответа" text={ticket.draft ?? ""} readOnly />
      {error && <p role="alert" className="t-body-m">{error}</p>}
      <div className="sheet__actions" aria-busy={busy}>
        {actions.filter(a => a !== "cancel_confirmation" && ticket.actions.includes(a)).map(a =>
          <Button key={a} label={labels[a]} variant={a === "start_confirmation" || a === "approve_preview" || a === "reopen_preview" ? "primary" : "secondary"} fill disabled={busy}
            onClick={() => {
              if (a === "edit_preview") begin();
              else void save(a);
            }} />)}
        <Button label="Закрыть" variant="ghost" fill disabled={busy} onClick={onClose} />
      </div>
    </SheetView>
    {ticket.state === "confirming" && ticket.confirmation_deadline &&
      <Confirmation deadline={ticket.confirmation_deadline} canCancel={ticket.actions.includes("cancel_confirmation") && !busy}
        cancel={() => void save("cancel_confirmation")} />}
  </>;
}

function Confirmation({ deadline, canCancel, cancel }: { deadline: string; canCancel: boolean; cancel: () => void }) {
  const ends = Date.parse(deadline);
  const remaining = () => Math.max(0, Math.ceil((ends - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(remaining);
  useEffect(() => {
    let previous = remaining();
    setSeconds(previous);
    const update = () => {
      const next = remaining();
      if (next !== previous && next > 0 && !document.hidden) tick();
      previous = next;
      setSeconds(next);
    };
    const timer = window.setInterval(update, 200);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [ends]);
  return <div className="undo-toast" role="status"><div className="undo-toast__body t-body-m-medium">
    <span className="undo-ring" aria-label="Осталось секунд"><span className="undo-ring__num">{seconds}</span></span>
    <span className="undo-toast__text">{seconds > 0 ? "До отправки" : "Проверяю статус"}</span>
    {canCancel && seconds > 0 && <button type="button" className="undo-toast__cancel" aria-label="Отменить подтверждение" onClick={cancel}><Icon name="close" size={20} /></button>}
  </div></div>;
}

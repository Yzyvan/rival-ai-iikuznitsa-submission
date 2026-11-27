import { useEffect, useState } from "react";
import { canEdit, fetchBoardData } from "../api/mailBoard";

type Document = { text: string; version: string; body?: string | null; webLink?: string | null };
export function BoardDocument({ kind, id }: { kind: "mail" | "protocol"; id: string }) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [text, setText] = useState("");
  const [editing, edit] = useState(false);
  const [message, inform] = useState("");
  const [saving, save] = useState(false);
  const [reload, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchBoardData("./api/owner/document?" + new URLSearchParams({kind,id}), controller.signal)
      .then(async response => {
        if (response.status === 404) throw Error("Запись больше недоступна.");
        if (!response.ok) throw Error("Документ недоступен.");
        const data: Document = await response.json();
        if (!controller.signal.aborted) { setDoc(data); setText(data.text); inform(""); }
      }).catch(e => {if (!controller.signal.aborted) inform(e.message);});
    return () => controller.abort();
  }, [kind,id,reload]);
  async function persist() {
    if (!doc || saving) return;
    save(true);
    try {
      const res = await fetchBoardData("./api/owner/document", undefined, {kind,id,text,version:doc.version});
      if (!res.ok) throw Error(res.status === 409 ? "Документ изменился. Скопируйте свои правки и загрузите актуальную версию." : "Не удалось сохранить.");
      edit(false); refresh(n => n+1);
    } catch(e) { inform(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { save(false); }
  }
  const label = kind === "mail" ? "Черновик ответа в Vilar" : "Протокол встречи";
  return <div className="stack" style={{gap:12}}>
    {doc?.body !== undefined && <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{doc.body === null ? "В архивной записи сохранилась только тема письма." : doc.body || "Письмо без текста."}</p>}
    {doc?.webLink?.startsWith("https://outlook.") && <a href={doc.webLink} target="_blank" rel="noreferrer">Открыть письмо в Outlook</a>}
    {doc && <><strong>{label}</strong>
      {editing ? <textarea aria-label={label} rows={8} value={text} onChange={e => setText(e.target.value)} /> :
        <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{doc.text || (kind === "mail" ? "Черновик пока пуст." : "Протокол пока не создан.")}</p>}
      {canEdit && <button className="btn btn--secondary" disabled={saving} onClick={() => editing ? persist() : edit(true)}>{editing ? "Сохранить" : "Редактировать"}</button>}
    </>}
    {message && <><p role="status">{message}</p><button onClick={() => {edit(false); refresh(n => n+1);}}>Загрузить заново</button></>}
  </div>;
}

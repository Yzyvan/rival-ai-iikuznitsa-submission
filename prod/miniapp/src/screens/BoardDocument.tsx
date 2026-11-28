import { useEffect, useState, type ReactNode } from "react";
import { canEdit, fetchBoardData } from "../api/mailBoard";
import { notifyAttention } from "../api/attention";
import { Button, DraftCard, VilarHint } from "../ui";

/** GET ./api/owner/document?kind=…&id=…: text — черновик, body — само письмо; recommendation = no_reply — отвечать не нужно */
type Document = { text: string; version: string; body?: string | null; webLink?: string | null; recommendation?: string | null };

/** Текст письма или протокола с сервера: исходное письмо и черновик, который можно поправить на месте (карандаш → галочка — сохранить).
    Сохранение — POST ./api/owner/document { kind, id, text, version }; черновик остаётся черновиком, письмо никуда не уходит.
    onText — текущий текст черновика (после загрузки и после сохранения); aside — что показать между письмом и черновиком (сводка Vilar). */
export function BoardDocument({ kind, id, onText, onMissing, aside }: { kind: "mail" | "protocol"; id: string; onText?: (text: string) => void; onMissing?: (id: string) => void; aside?: ReactNode }) {
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
        if (!response.ok) throw Error("Документ недоступен.");
        const data: Document = await response.json();
        if (!controller.signal.aborted) { setDoc(data); inform(""); onText?.(data.text ?? ""); }
      }).catch((e) => { if (!controller.signal.aborted) inform(e.message); });
    return () => controller.abort();
  }, [kind, id, reload, onMissing, onText]);
  async function persist(text: string) {
    if (!doc || saving) return;
    save(true);
    try {
      const res = await fetchBoardData("./api/owner/document", undefined, { kind, id, text, version: doc.version });
      if (!res.ok) throw Error(res.status === 409 ? "Документ изменился. Скопируйте свои правки и загрузите актуальную версию." : "Не удалось сохранить.");
      refresh((n) => n + 1);
      notifyAttention();
    } catch (e) { inform(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { save(false); }
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      {doc?.body !== undefined && <p className="t-body-l" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{doc.body === null ? "В архивной записи сохранилась только тема письма." : doc.body || "Письмо без текста."}</p>}
      {doc?.webLink?.startsWith("https://outlook.") && <a className="btn btn--secondary btn--s btn--fill" style={{ textDecoration: "none" }} href={doc.webLink} target="_blank" rel="noreferrer">Открыть письмо в Outlook</a>}
      {aside}
      {kind === "mail" && doc?.recommendation === "no_reply" && <VilarHint text="Ответ не требуется" />}
      {doc && <DraftCard key={doc.version} caption={kind === "mail" ? "Черновик ответа в Vilar" : "Протокол встречи"} text={doc.text} readOnly={!canEdit}
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

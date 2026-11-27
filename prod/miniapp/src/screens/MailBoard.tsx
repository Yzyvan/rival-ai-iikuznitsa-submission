import { useEffect, useState } from "react";
import { fetchImportedMail, TelegramLaunchError, telegramWebApp, type ImportedMail } from "../api/mailBoard";
import { createPortal } from "react-dom";
import { SheetView } from "./SheetView";
import { ListRow, Section } from "../ui";

export function useImportedMail() {
  const [messages, setMessages] = useState<ImportedMail[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchImportedMail(controller.signal).then(
      setMessages,
      (err: Error) => { if (!controller.signal.aborted) setError(err); },
    );
    return () => controller.abort();
  }, [request]);

  return { messages, error, refresh: () => setRequest(previous => previous + 1) };
}

function snapshotDate(message: ImportedMail) {
  return "Срез за " + new Date(message.day + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function MailBoard({ mail }: { mail: ReturnType<typeof useImportedMail> }) {
  const { messages, error, refresh } = mail;
  const [selected, setSelected] = useState<ImportedMail | null>(null);
  const telegram = telegramWebApp();
  const needsNewLaunch = error instanceof TelegramLaunchError;
  return (
    <Section title="Загруженные письма">
      {error && <p role="alert" className="t-body-m c-secondary">{error.message}</p>}
      {needsNewLaunch && Boolean(telegram?.initDataUnsafe?.user) && telegram?.close &&
        <button type="button" className="btn btn--secondary btn--s" onClick={() => telegram.close?.()}>Закрыть Vilar</button>}
      {error && !needsNewLaunch &&
        <button type="button" className="btn btn--secondary btn--s" onClick={refresh}>Повторить</button>}
      {!error && messages === null && <p role="status" className="t-body-m c-secondary">Загрузка…</p>}
      {!error && messages?.length === 0 && <p className="t-body-m c-secondary">Загруженных писем пока нет.</p>}
      {messages?.map(message => (
        <ListRow key={message.id} title={message.title}
          subtitle={snapshotDate(message)} onClick={() => setSelected(message)} />
      ))}
      {selected && createPortal(
        <SheetView key={selected.id} sheet={{
          title: selected.title,
          tags: ["Outlook", snapshotDate(selected)],
          actions: [["Закрыть", "ghost", "close"]],
        }} onAction={() => setSelected(null)} />,
        document.querySelector(".app")!,
      )}
    </Section>
  );
}

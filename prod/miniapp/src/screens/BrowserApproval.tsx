import { useEffect, useState } from "react";
import { canEdit, fetchBoardData, isBrowserTest, telegramWebApp } from "../api/mailBoard";
import { Section } from "../ui";

type Access = { edit: boolean; grantId: string; expires: number };

export function BrowserApproval() {
  const [access, setAccess] = useState<Access | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inTelegram = Boolean(telegramWebApp()?.initData);

  useEffect(() => {
    if (!inTelegram) return;
    const controller = new AbortController();
    fetchBoardData("./api/owner/access", controller.signal)
      .then(async response => {
        if (response.ok) setAccess(await response.json());
      })
      .catch(() => {});
    return () => controller.abort();
  }, [inTelegram]);

  async function toggle() {
    if (!access) return;
    setBusy(true);
    try {
      const edit = !access.edit;
      const result = await fetchBoardData("./api/owner/access", undefined, {grantId: access.grantId, edit});
      if (!result.ok) throw new Error("Обновите профиль и повторите попытку.");
      setAccess({...access, edit});
      setMessage(edit ? "Редактирование по действующей ссылке включено." : "По ссылке доступно только чтение.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения.");
    } finally {
      setBusy(false);
    }
  }

  if (isBrowserTest) return <Section title="Доступ по ссылке">
    <p>{canEdit ? "Редактирование включено." : "Владелец может включить редактирование в профиле Vilar в Telegram. После этого обновите страницу."}</p>
  </Section>;
  if (!access) return null;
  return <Section title="Доступ по ссылке">
    <p>Все, у кого есть действующая тестовая ссылка, {access.edit ? "могут" : "смогут"} сохранять правки в Vilar до {new Date(access.expires * 1000).toLocaleString("ru-RU", {timeZone: "Europe/Moscow"})} МСК.</p>
    <button className="btn btn--secondary" disabled={busy} onClick={toggle}>
      {access.edit ? "Отключить редактирование по ссылке" : "Разрешить редактирование по ссылке"}
    </button>
    {message && <p role="status">{message}</p>}
  </Section>;
}

import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "../ui";

import { completeMicrosoftLogin, connectionsApi as api, microsoftLink, telegram, type Connections } from "../api/connections";
const labels = { connected: "Подключено", needs_login: "Требуется вход", error: "Ошибка доступа" };

export function OutlookConnections({ profile = false, onChange }: { profile?: boolean; onChange?: (state: Connections) => void }) {
  const [connections, setConnections] = useState<Connections>();
  const [url, setUrl] = useState("");
  const [waiting, setWaiting] = useState(false);
  const mode = useRef<"read" | "manage">("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const mounted = useRef(false);
  useEffect(() => { if (connections) onChange?.(connections); }, [connections, onChange]);
  const message = (e: unknown) => e instanceof Error && e.name === "Error" ? e.message : "Сервис подключений недоступен.";

  useEffect(() => {
    mounted.current = true;
    const sequence = ++generation.current;
    (async () => {
      try {
        const login = await completeMicrosoftLogin();
        const data = await api<Connections>("/me/connections");
        if (sequence === generation.current) {
          setConnections(data);
          if (login === "error") setError("Microsoft не выдал доступ. Можно повторить вход.");
        }
      } catch (e) {
        if (sequence === generation.current) setError(message(e));
      }
    })();
    return () => { mounted.current = false; ++generation.current; };
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const deadline = Date.now() + 600000;
    let alive = true, loading = false;
    const refresh = async () => {
      if (document.hidden || loading) return;
      if (Date.now() > deadline) {
        setWaiting(false); setError("Время входа истекло. Начните ещё раз."); return;
      }
      loading = true;
      try {
        const data = await api<Connections>("/me/connections");
        if (alive) {
          setConnections(data);
          if (data.mail === "connected" && data.calendar === "connected" &&
              (mode.current === "read" || data.can_manage)) setWaiting(false);
        }
      } catch (e) { if (alive) setError(message(e)); }
      finally { loading = false; }
    };
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [waiting]);

  async function act(action: () => Promise<void>) {
    if (busy) return;
    ++generation.current;
    setBusy(true); setError(""); setWaiting(false);
    try { await action(); } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const prepare = (requested: "read" | "manage") => act(async () => {
    mode.current = requested;
    setUrl(await microsoftLink(requested));
  });
  const open = () => {
    try { telegram()!.openLink!(url); setWaiting(true); setUrl(""); }
    catch { setError("Не удалось открыть Microsoft. Повторите вход."); }
  };
  const linked = connections?.mail === "connected" || connections?.calendar === "connected";
  return <>
    {([["calendar", "Календарь Outlook", "outlook-calendar"], ["mail", "Почта Outlook", "outlook"]] as const)
      .map(([key, title, logo]) => <div key={key} className="onb-card onb-card--row">
        <img src={`./assets/logos/${logo}.svg`} width={32} height={32} alt="" />
        <span className="list-row__text"><span className="t-body-l">{title}</span>
          <span className="t-body-m c-secondary">{connections ? labels[connections[key]] : error ? "Статус недоступен" : "Проверяем подключение…"}</span></span>
        {connections?.[key] === "connected" && <span className="status status--done-dark"><Icon name="check-circle" size={18}/></span>}
      </div>)}
    {error && <p role="alert" className="t-body-m">{error}</p>}
    {busy ? <p role="status" className="t-body-m">Подождите…</p> : <>
      {waiting && <p role="status" className="t-body-m">Завершите вход в браузере и вернитесь по ссылке в Telegram.</p>}
      {url ? <Button label="Продолжить в Microsoft" variant="secondary" fill size="s" onClick={open} />
        : (!linked || connections?.mail !== "connected" || connections?.calendar !== "connected") &&
          <Button label="Войти в Microsoft" variant="secondary" size="s" fill onClick={() => prepare("read")} />}
      {profile && linked && !connections?.can_manage && !url && <Button label="Разрешить черновики и изменение встреч" variant="secondary" size="s" fill onClick={() => prepare("manage")} />}
      {profile && <Button label="Проверить доступ" variant="secondary" size="s" fill onClick={() => act(async () => {
        setConnections(await api("/me/connections/check", "POST"));
      })} />}
      {profile && connections && (linked || connections.mail === "error" || connections.calendar === "error" || waiting || url) &&
        <Button label="Отключить Microsoft" variant="ghost" size="s" fill onClick={() => act(async () => {
          setConnections(await api("/me/connections/microsoft", "DELETE")); setUrl("");
        })} />}
    </>}
  </>;
}

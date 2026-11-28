import { useEffect, useRef, useState } from "react";
import { canEdit, fetchBoardData, hasAccountLaunch, isBrowserTest } from "../api/mailBoard";
import { useSelf } from "../api/tracker";
import { completeMicrosoftLogin, connectionsApi, microsoftLink, telegram, type Connections } from "../api/connections";
import { useMail } from "./MailStage";
import { useCalendar } from "./CalendarBoard";
import { toneOf, ActionBar, Button, Icon, IconButton, ListRow, ScreenHeader, Section, Segmented, Tags, Toggle } from "../ui";
import { OutlookConnections } from "./OutlookConnections";
import { useNav } from "../nav";

/** Профиль: подключения, время резюме перед встречей и сохранённые правки.
    Что Vilar решает сам, а что только с подтверждением, задаётся в регистрации; деньги, кадры, обязательства клиентам
    и письма руководству он не решает никогда — переключателей для этого нет. */
export function Profile() {
  const nav = useNav();
  const self = useSelf(hasAccountLaunch);
  const name = hasAccountLaunch ? self.name : "Иван Петров";
  const initials = hasAccountLaunch ? self.initials : "ИП";
  const username = hasAccountLaunch ? self.username : "@ivan_petrov";
  return (
    <div className="screen">
      <div className="scroll">
        <ScreenHeader title="Мой профиль" left={<IconButton icon="close" label="Закрыть" onClick={() => nav("back")} />} right={<IconButton icon="help-circle" label="Как это работает" onClick={() => nav("sheet:help")} />} />
        <div className="body" style={{ gap: 28, paddingTop: 20, paddingBottom: 152 }}>
          <div className="stack" style={{ alignItems: "center", gap: 12 }}>
            <span className={`avatar avatar--88 avatar--${toneOf(initials)}`}>{initials}</span>
            <div className="stack" style={{ alignItems: "center" }}>
              {!hasAccountLaunch && <span className="t-body-m c-secondary">Руководитель направления SMB и Digital</span>}
              <span className="t-title-l">{name ?? (self.error ? "Профиль недоступен" : "Загрузка…")}</span>
              {username && <span className="t-body-m c-secondary">{username}</span>}
            </div>
          </div>
          {hasAccountLaunch ? <><LiveConnections /><AccountSettings /><LinkAccess /></> : <>
            <Section title="Подключения">
              <ConnectionRow logo="telegram" title="Telegram" subtitle="мини-апп и уведомления" connected />
              <ConnectionRow logo="outlook" title="Почта Outlook" subtitle="письма от вашего имени" connected />
              <ConnectionRow logo="outlook-calendar" title="Календарь Outlook" subtitle="встречи и занятость" connected />
            </Section>
            <Section title="Резюме перед встречей">
              <Segmented options={["за 10 мин", "за 15 мин", "за 30 мин"]} defaultIndex={1} />
            </Section>
            <Section title="Сохранённые правки">
              <ListRow title="Порядок протокола" subtitle="решения → поручения" status={["отозвать", "Нейтрально", "Темная"]} onClick={() => nav("toast:t8")} />
              <ListRow title="Договорённости с клиентами" subtitle="исполнитель — Ольга Смирнова" status={["отозвать", "Нейтрально", "Темная"]} onClick={() => nav("toast:t8")} />
            </Section>
          </>}
        </div>
      </div>
      {!hasAccountLaunch && <ActionBar>
        <Button label="Подключить и прислать первый план" fill onClick={() => nav("home")} />
      </ActionBar>}
    </div>
  );
}

/** Строка подключения: подключено — галочка, не подключено — кнопка «Добавить» */
function ConnectionRow({ logo, title, subtitle, connected, action = "Добавить", onAdd }: { logo: string; title: string; subtitle?: string; connected: boolean; action?: string; onAdd?: () => void }) {
  return (
    <div style={{ display: "block", width: "100%" }}>
      <span className="list-row">
        <span className="list-row__leading"><img src={`./assets/logos/${logo}.svg`} width={32} height={32} alt="" /></span>
        <span className="list-row__text"><span className="t-body-l">{title}</span>{subtitle && <Tags items={[subtitle]} />}</span>
        {connected
          ? <span role="img" aria-label="подключено" style={{ display: "inline-flex", flex: "none", color: "var(--status-done-fg)" }}><Icon name="check" size={24} /></span>
          : <Button label={action} variant="secondary" size="s" onClick={onAdd} />}
      </span>
    </div>
  );
}

/** Подключения после входа: Telegram, почта и календарь Outlook.
    Состояние отдаёт служба подключений; если она не ответила — судим по тому, читаются ли письма и встречи. */
function LiveConnections() {
  const mail = useMail();
  const calendar = useCalendar(true);
  const [state, setState] = useState<Connections | null>(null);
  const [link, setLink] = useState<{ row: "mail" | "calendar"; url: string } | null>(null);   // ссылка на вход в Microsoft получена — ждём второго нажатия
  const [manage, setManage] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    // если вернулись из Microsoft — сначала завершаем вход, потом читаем состояние
    completeMicrosoftLogin().then((result) => {
      if (alive.current && result === "error") setError("Microsoft не выдал доступ. Можно повторить вход.");
      return connectionsApi<Connections>("/me/connections");
    }).then((c) => { if (alive.current) setState(c); }, () => {});
    return () => { alive.current = false; };
  }, []);
  // после входа в Microsoft в браузере перечитываем состояние, пока оно не изменится (не дольше 10 минут)
  useEffect(() => {
    if (!waiting) return;
    const until = Date.now() + 600000;
    const timer = window.setInterval(async () => {
      if (Date.now() > until) { setWaiting(false); return; }
      try { const c = await connectionsApi<Connections>("/me/connections"); if (alive.current) { setState(c); if (c.mail === "connected" && c.calendar === "connected" && c.can_manage) setWaiting(false); } } catch { /* попробуем ещё раз */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting]);

  const mailRead = state ? state.mail === "connected" : !!(mail.tickets || mail.legacy);
  const mailOk = mailRead && (state ? state.can_manage : true);
  const calendarOk = state ? state.calendar === "connected" : !!calendar.meetings;
  const add = async (row: "mail" | "calendar") => {
    setError("");
    if (link?.row === row) {   // второе нажатие: открываем вход в Microsoft
      try { telegram()!.openLink!(link.url); setLink(null); setWaiting(true); } catch { setError("Не удалось открыть Microsoft. Повторите."); }
      return;
    }
    try { setLink({ row, url: await microsoftLink(row === "mail" && mailRead ? "manage" : "read") }); }
    catch (e) { setError(e instanceof Error ? e.message : "Сервис подключений недоступен."); }
  };
  const label = (row: "mail" | "calendar") => (link?.row === row ? "Продолжить" : "Добавить");
  return (
    <Section title="Подключения">
      <ConnectionRow logo="telegram" title="Telegram" subtitle="мини-апп и уведомления" connected />
      <ConnectionRow logo="outlook" title="Почта Outlook" subtitle={mailRead && !mailOk ? "нужно разрешение отправлять письма" : "письма от вашего имени"} connected={mailOk} action={label("mail")} onAdd={() => void add("mail")} />
      <ConnectionRow logo="outlook-calendar" title="Календарь Outlook" subtitle="встречи и занятость" connected={calendarOk} action={label("calendar")} onAdd={() => void add("calendar")} />
      {!isBrowserTest && <button className="btn btn--secondary" aria-expanded={manage} onClick={() => setManage(!manage)}>Настройки Microsoft</button>}
      {manage && <OutlookConnections profile onChange={setState} />}
      {waiting && <p role="status" className="t-body-m c-secondary">Завершите вход в браузере и вернитесь в Telegram.</p>}
      {error && <p role="alert" className="t-body-m c-secondary">{error}</p>}
    </Section>
  );
}

type Settings = { brief_minutes: number } & Record<string, boolean | number>;
type SavedProfile = { settings: Settings; version: string; edits: { mail?: number; protocol?: number } };
const times = [10, 15, 30];
/** Настройки с сервера: время резюме перед встречей */
function AccountSettings() {
  const [data, setData] = useState<SavedProfile>();
  const [message, setMessage] = useState("");
  const [revision, reload] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchBoardData("./api/owner/profile", controller.signal).then(async (r) => {
      if (!r.ok) throw Error("Настройки профиля недоступны.");
      const saved = await r.json();
      if (!controller.signal.aborted) setData(saved);
    }).catch((e) => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, [revision]);
  async function change(settings: Settings) {
    if (!canEdit || busy.current || !data) return;
    busy.current = true; setMessage("");
    try {
      const res = await fetchBoardData("./api/owner/profile", undefined, { settings, version: data.version });
      if (res.status === 409) { setData(undefined); reload((n) => n + 1); throw Error("Настройки изменились. Повторите правку."); }
      if (!res.ok) throw Error("Не удалось сохранить настройки.");
      setData(await res.json());
    } catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { busy.current = false; }
  }
  return <>
    {message && <p role="status" className="t-body-m c-secondary">{message}</p>}
    {data ? <>
      <Section title="Резюме перед встречей">
        <Segmented index={times.indexOf(data.settings.brief_minutes)} options={times.map((t) => "за " + t + " мин")}
          onChange={(i) => void change({ ...data.settings, brief_minutes: times[i] })} />
      </Section>
      {/* «Сохранённые правки» после входа не показываем: сервер отдаёт только число правок, без самих правил и без отзыва.
          Блок вернётся списком с «отозвать», как в макете, когда сервер начнёт отдавать saved_rules. */}
    </> : !message && <p role="status" className="t-body-m c-secondary">Загрузка настроек…</p>}
  </>;
}

type Access = { edit: boolean; grantId: string; expires: number };
/** Тестовая ссылка стенда: владелец из Telegram решает, можно ли по ней не только смотреть, но и нажимать.
    Нужна, чтобы стенд можно было открыть в обычном браузере (жюри, проверка). Тем, кто вошёл по ссылке, не показывается. */
function LinkAccess() {
  const [access, setAccess] = useState<Access | null>(null);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const owner = !isBrowserTest && Boolean(telegram()?.initData);
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    fetchBoardData("./api/owner/access", controller.signal).then(async (r) => { if (r.ok) setAccess(await r.json()); }).catch(() => {});
    return () => controller.abort();
  }, [owner]);
  if (!access) return null;
  const toggle = async (edit: boolean) => {
    if (busy.current) return;
    busy.current = true; setMessage("");
    try {
      const res = await fetchBoardData("./api/owner/access", undefined, { grantId: access.grantId, edit });
      if (!res.ok) throw new Error("Не удалось сохранить. Обновите профиль и повторите.");
      setAccess({ ...access, edit });
    } catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { busy.current = false; }
  };
  const until = new Date(access.expires * 1000).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Section title="Тестовая ссылка">
      <div className="toggle-row">
        <div className="list-row__text"><span className="t-body-l">Разрешить действия по ссылке</span><span className="t-body-m c-secondary">ссылка работает до {until}</span></div>
        <Toggle label="Разрешить действия по ссылке" on={access.edit} onChange={(v) => void toggle(v)} />
      </div>
      {message && <p role="status" className="t-body-m c-secondary">{message}</p>}
    </Section>
  );
}

import { useEffect, useRef, useState } from "react";
import { canEdit, fetchBoardData, hasAccountLaunch } from "../api/mailBoard";
import { useTaskRead, type People } from "../../../../integrations/tracker/transport/bindings";
import { useImportedMail } from "./MailBoard";
import { useCalendar } from "./CalendarBoard";
import { BrowserApproval } from "./BrowserApproval";
import { toneOf, ActionBar, Button, IconButton, ListRow, ScreenHeader, Section, Segmented, Toggle, ToggleRow } from "../ui";
import { OutlookConnections } from "./OutlookConnections";
import { useNav } from "../nav";

/** Профиль и правила: подключения и то, о чём Vilar всегда спрашивает. */
export function Profile() {
  const nav = useNav();
  const people = useTaskRead<People>(hasAccountLaunch ? "people" : null);
  const person = people.data?.rows.find(p => p.id === people.data?.self_id);
  const name = hasAccountLaunch ? person?.name : "Иван Петров";
  const initials = name?.trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "…";
  return (
    <div className="screen">
      <div className="scroll">
        <ScreenHeader title="Мой профиль" left={<IconButton icon="close" label="Закрыть" onClick={() => nav("back")} />} right={<IconButton icon="help-circle" label="Как это работает" onClick={() => nav("sheet:help")} />} />
        <div className="body" style={{ gap: 28, paddingTop: 20, paddingBottom: 152 }}>
          <div className="stack" style={{ alignItems: "center", gap: 12 }}>
            <span className={`avatar avatar--88 avatar--${toneOf(initials)}`}>{initials}</span>
            <div className="stack" style={{ alignItems: "center" }}>
              {!hasAccountLaunch && <span className="t-body-m c-secondary">Директор по продажам</span>}
              <span className="t-title-l">{name ?? (people.error ? "Профиль недоступен" : "Загрузка…")}</span>
              <span className="t-body-m c-secondary">{hasAccountLaunch ? person && "@aegis_ivan" : "@ivan_petrov"}</span>
            </div>
          </div>
          <BrowserApproval />
          {hasAccountLaunch ? <><AccountConnections /><AccountSettings /></> : <>
          <Section title="Подключения">
            <OutlookConnections profile />
            <ListRow leading={<img src="./assets/logos/telegram.svg" width={32} height={32} alt="" />} title="Telegram" subtitle="мини-апп и уведомления" status={["ждёт /start", "Внимание", "Яркая"]} />
          </Section>
          <Section title="Всегда спрашивать меня">
            <ToggleRow title="Деньги и бюджеты" subtitle="даже небольшие суммы" />
            <ToggleRow title="Кадровые решения" subtitle="найм, отпуска, переводы" />
            <ToggleRow title="Обязательства клиентам" subtitle="сроки, скидки, КП" />
            <ToggleRow title="Письма руководству" subtitle="коммерческому директору и выше" />
            <ToggleRow title="Переносы внутренних встреч" subtitle="иначе Vilar переносит сам" defaultOn={false} />
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


function AccountConnections() {
  const mail = useImportedMail();
  const calendar = useCalendar(true);
  const [settings, setSettings] = useState(false);
  return <Section title="Подключения">
    <ListRow leading={<img src="./assets/logos/outlook.svg" width={32} height={32} alt="" />} title="Почта Outlook"
      subtitle={mail.error ? "Загрузка недоступна" : mail.messages ? "Записей в почте: " + mail.messages.length : "Загрузка…"} />
    <ListRow leading={<img src="./assets/logos/outlook-calendar.svg" width={32} height={32} alt="" />} title="Календарь Outlook"
      subtitle={calendar.error ? "Загрузка недоступна" : calendar.meetings ? "Встреч в календаре: " + calendar.meetings.length : "Загрузка…"} />
    <button className="btn btn--secondary" aria-expanded={settings} onClick={() => setSettings(value => !value)}>Настройки Microsoft</button>
    {settings && <OutlookConnections profile />}
  </Section>;
}

const rules = [
  ["finance", "Деньги и бюджеты", "даже небольшие суммы"],
  ["personnel", "Кадровые решения", "найм, отпуска, переводы"],
  ["clients", "Обязательства клиентам", "сроки, скидки, КП"],
  ["management_mail", "Письма руководству", "коммерческому директору и выше"],
  ["internal_meetings", "Переносы внутренних встреч", "изменения в календаре"],
] as const;
type Settings = Record<typeof rules[number][0], boolean> & {brief_minutes: number};
type SavedProfile = {settings: Settings; version: string; edits: {mail?: number; protocol?: number}};
const times = [10, 15, 30];
function AccountSettings() {
  const [data, setData] = useState<SavedProfile>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, reload] = useState(0);
  const busy = useRef(false);
  const nav = useNav();
  useEffect(() => {
    const controller = new AbortController();
    fetchBoardData("./api/owner/profile", controller.signal).then(async r => {
      if (!r.ok) throw Error("Настройки профиля недоступны.");
      const saved = await r.json();
      if (!controller.signal.aborted) setData(saved);
    }).catch(e => { if (!controller.signal.aborted) setMessage(e.message); });
    return () => controller.abort();
  }, [revision]);
  async function change(settings: Settings) {
    if (!canEdit || busy.current || !data) return;
    busy.current = true; setLoading(true); setMessage("");
    try {
      const res = await fetchBoardData("./api/owner/profile", undefined, {settings, version:data.version});
      if (res.status === 409) {
        setData(undefined); reload(n => n+1);
        throw Error("Настройки изменились. Повторите правку в обновлённом профиле.");
      }
      if (!res.ok) throw Error("Не удалось сохранить настройки.");
      setData(await res.json());
    } catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { busy.current = false; setLoading(false); }
  }
  return <>
    {message && <p role="status">{message}</p>}
    {data ? <>
      <fieldset disabled={!canEdit || loading} style={{border:0, margin:0, padding:0}}>
        <Section title="Всегда спрашивать меня">
          {rules.map(([key, title, subtitle]) => <div className="toggle-row" key={key}>
            <div className="list-row__text"><span className="t-body-l">{title}</span><span className="t-body-m c-secondary">{subtitle}</span></div>
            <Toggle label={title} on={data.settings[key]} onChange={value => void change({...data.settings, [key]:value})} />
          </div>)}
        </Section>
        <Section title="Резюме перед встречей">
          <Segmented index={times.indexOf(data.settings.brief_minutes)} options={times.map(t => "за " + t + " мин")}
            onChange={i => void change({...data.settings, brief_minutes:times[i]})} />
        </Section>
      </fieldset>
      <Section title="Сохранённые правки">
        <ListRow title="Черновики ответов" value={String(data.edits.mail ?? 0)} onClick={() => nav("board:mail")} />
        <ListRow title="Протоколы встреч" value={String(data.edits.protocol ?? 0)} onClick={() => nav("board:meetings")} />
      </Section>
    </> : !message && <p role="status">Загрузка настроек…</p>}
  </>;
}

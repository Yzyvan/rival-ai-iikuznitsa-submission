import { toneOf, ActionBar, Button, IconButton, ListRow, ScreenHeader, Section, Segmented, ToggleRow } from "../ui";
import { OutlookConnections } from "./OutlookConnections";
import { useNav } from "../nav";

/** Профиль и правила: подключения и то, о чём Vilar всегда спрашивает. */
export function Profile() {
  const nav = useNav();
  return (
    <div className="screen">
      <div className="scroll">
        <ScreenHeader title="Мой профиль" left={<IconButton icon="close" label="Закрыть" onClick={() => nav("back")} />} right={<IconButton icon="help-circle" label="Как это работает" onClick={() => nav("sheet:help")} />} />
        <div className="body" style={{ gap: 28, paddingTop: 20, paddingBottom: 152 }}>
          <div className="stack" style={{ alignItems: "center", gap: 12 }}>
            <span className={`avatar avatar--88 avatar--${toneOf("ИП")}`}>ИП</span>
            <div className="stack" style={{ alignItems: "center" }}>
              <span className="t-body-m c-secondary">Директор по продажам</span>
              <span className="t-title-l">Иван Петров</span>
              <span className="t-body-m c-secondary">@ivan_petrov</span>
            </div>
          </div>
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
        </div>
      </div>
      <ActionBar>
        <Button label="Подключить и прислать первый план" fill onClick={() => nav("home")} />
      </ActionBar>
    </div>
  );
}

import { IconButton, InsightCard, ScreenHeader } from "../ui";
import { useNav } from "../nav";

/** Нет доступа: ссылка открыта из чужого профиля. */
export function NoAccess() {
  const nav = useNav();
  return (
    <div className="screen">
      <ScreenHeader title="Vilar" left={<IconButton icon="close" label="Закрыть" onClick={() => nav("home")} />} right={<IconButton icon="help-circle" label="Как это работает" onClick={() => nav("sheet:help")} />} />
      <div className="stack" style={{ flex: 1, justifyContent: "center", gap: 20, padding: "0 16px" }}>
        <InsightCard icon="lock" title="Это встреча другого руководителя" body="Ссылка открыта из чужого профиля. Vilar не показывает протокол, участников и поручения." action="Открыть мою доску" onAction={() => nav("home")} />
      </div>
    </div>
  );
}

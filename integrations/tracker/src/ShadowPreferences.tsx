import { useState, type FormEvent } from "react";
import type { PriorityBindings, PrioritySettings, ShadowSettings } from "./bindings";

function Summary({ value }: { value: ShadowSettings }) {
  return <dl className="live-task-info">
    <dt>Хранение журнала</dt><dd>{value.retention_days} дн.</dd>
    {value.reserve_minutes != null && <><dt>Резерв</dt><dd>{value.reserve_minutes} мин.</dd></>}
    {value.loss_thresholds && <><dt>Границы потерь</dt><dd>{value.loss_thresholds.join(" / ")} ч простоя команды</dd></>}
    {value.preference_weights && <><dt>Веса зависимости, фокуса, длительности и срока</dt><dd>{value.preference_weights.join(" / ")}</dd></>}
  </dl>;
}

function ProposalForm({ settings, submit, busy }: {
  settings: ShadowSettings | null;
  submit: (value: ShadowSettings) => void;
  busy: boolean;
}) {
  const [error, setError] = useState("");
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const reserve = fields.get("reserve");
    const bounds = [0, 1, 2].map(i => fields.get("loss" + i));
    const thresholds = bounds.some(Boolean) ? bounds.map(Number) : undefined;
    if (thresholds && (bounds.some(v => !v) || thresholds.some((n, i) => n <= 0 || (i > 0 && n <= thresholds[i - 1])))) {
      setError("Укажите все три границы в возрастающем порядке или оставьте их пустыми.");
      return;
    }
    setError("");
    submit({
      retention_days: Number(fields.get("retention")),
      ...(reserve ? { reserve_minutes: Number(reserve) } : {}),
      ...(thresholds ? { loss_thresholds: thresholds } : {}),
      ...(settings?.preference_weights ? { preference_weights: settings.preference_weights } : {}),
    });
  }
  return <form className="live-task-fields" onSubmit={prepare}>
    <label>Хранить журнал, дней<input name="retention" type="number" min={1} max={365} defaultValue={settings?.retention_days ?? 30} required /></label>
    <label>Резерв до срока, минут<input name="reserve" type="number" min={0} max={525600} defaultValue={settings?.reserve_minutes ?? ""} /></label>
    <fieldset className="live-task-fields">
      <legend>Границы потерь в часах простоя команды</legend>
      {["Нижняя", "Средняя", "Верхняя"].map((label, i) => <label key={label}>{label}
        <input type="number" name={"loss" + i} step="any" min={0} defaultValue={settings?.loss_thresholds?.[i] ?? ""} /></label>)}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} className="btn btn--secondary">Подготовить настройки</button>
  </form>;
}

function Preferences({ api, value }: { api: PriorityBindings; value: PrioritySettings }) {
  const write = api.useSettingChange();
  const [editing, setEditing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  return <>
    <p role="status">{value.enabled ? "Теневой журнал включён." : "Теневой журнал выключен."}</p>
    <p>С вашего согласия Vilar сохраняет доступные варианты, свой прогноз и ваш выбор для сравнения очередей.</p>
    {value.settings && <Summary value={value.settings} />}
    {value.proposal && <>
      <h3 className="t-title-s">Настройки на подтверждение</h3>
      <Summary value={value.proposal} />
      <button className="btn btn--primary" disabled={write.busy}
        onClick={() => write.send({ operation: "confirm", expected_version: value.version }, () => {})}>Подтвердить и включить журнал</button>
    </>}
    {editing ? <ProposalForm settings={value.proposal ?? value.settings} busy={write.busy}
      submit={settings => write.send({ operation: "propose", expected_version: value.version, settings }, () => setEditing(false))} />
      : <button className="btn btn--secondary" onClick={() => setEditing(true)}>Настроить журнал</button>}
    {(value.enabled || value.proposal) && (revoking ? <>
      <p>Отзыв согласия удалит журнал показов и выборов этого профиля.</p>
      <button className="btn btn--secondary" disabled={write.busy}
        onClick={() => write.send({ operation: "revoke", expected_version: value.version }, () => setRevoking(false))}>Подтвердить отзыв</button>
      <button className="btn btn--ghost btn--s" onClick={() => setRevoking(false)}>Отмена</button>
    </> : <button className="btn btn--ghost btn--s" onClick={() => setRevoking(true)}>Отозвать согласие</button>)}
    {write.error && <p role="alert">{write.error}</p>}
  </>;
}

export function ShadowPreferences({ api, back }: { api: PriorityBindings; back: () => void }) {
  const read = api.useSettings();
  return <>
    <button className="btn btn--ghost btn--s" onClick={back}>К списку решений</button>
    <h3 className="t-title-s">Настройки персонализации</h3>
    {read.error ? <p role="alert">{read.error} <button onClick={read.refresh}>Повторить</button></p>
      : read.data ? <Preferences key={read.data.version} api={api} value={read.data} />
      : <p role="status">Загружаем настройки…</p>}
  </>;
}

import { useState } from "react";
import type { FactChange, PriorityBindings, PriorityFacts } from "./bindings";

function localTime(value: string | null) {
  if (!value) return "";
  const instant = new Date(value);
  return new Date(instant.getTime() - instant.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function FactForm({ facts, busy, send }: { facts: PriorityFacts; busy: boolean; send: (change: FactChange) => void }) {
  const [block, setBlock] = useState(facts.blocks_others);
  const [waiting, setWaiting] = useState(facts.waiting_for_response);
  const originalDay = facts.expected_response_at?.slice(0, 10) || "";
  const originalCheck = localTime(facts.check_at);
  const [day, setDay] = useState(originalDay);
  const [check, setCheck] = useState(originalCheck);
  const changes: FactChange = { expected_version: facts.version };
  if (block !== facts.blocks_others) changes.blocks_others = block;
  if (waiting !== facts.waiting_for_response) changes.waiting_for_response = waiting;
  if (waiting) {
    if (day !== originalDay) changes.expected_response_at = day || null;
    if (check !== originalCheck) changes.check_at = check ? new Date(check).toISOString() : null;
  } else if (facts.waiting_for_response) {
    changes.expected_response_at = null;
    changes.check_at = null;
  }
  return <form className="live-task-fields" onSubmit={e => { e.preventDefault(); send(changes); }}>
    <fieldset className="live-task-fields" disabled={busy}>
      <label className="live-task-check"><input type="checkbox" checked={block}
        onChange={e => setBlock(e.target.checked)} />Решение блокирует других</label>
      <label className="live-task-check"><input type="checkbox" checked={waiting}
        onChange={e => setWaiting(e.target.checked)} />Жду ответа</label>
      {waiting && <>
        <label>Обещанный день ответа<input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
        <label>Проверить ответ ({Intl.DateTimeFormat().resolvedOptions().timeZone})
          <input type="datetime-local" value={check} onChange={e => setCheck(e.target.value)} /></label>
      </>}
      <button className="btn btn--secondary" disabled={Object.keys(changes).length === 1}>Сохранить условия</button>
      {(facts.waiting_for_response || facts.expected_response_at || facts.check_at) &&
        <button type="button" className="btn btn--secondary" onClick={() => send({ expected_version: facts.version, response_confirmed: true })}>
          Ответ получен
        </button>}
    </fieldset>
  </form>;
}

export function PriorityFactsEditor({ api, stepId }: { api: PriorityBindings; stepId: string }) {
  const read = api.useFacts(stepId);
  const write = api.useFactChange();
  const [notice, setNotice] = useState("");
  if (read.error) return <p role="alert">{read.error} <button onClick={read.refresh}>Повторить</button></p>;
  if (!read.data) return <p role="status">Загружаем условия поручения…</p>;
  return <>
    <FactForm key={read.data.version} facts={read.data} busy={write.busy}
      send={change => { setNotice(""); write.send(stepId, change, () => setNotice("Условия сохранены."),
        () => setNotice("Поручение изменилось. Проверьте актуальные условия.")); }} />
    {notice && <p role="status">{notice}</p>}
    {write.error && <p role="alert">{write.error}</p>}
  </>;
}

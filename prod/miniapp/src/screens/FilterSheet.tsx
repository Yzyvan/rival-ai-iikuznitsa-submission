import { useRef, useState } from "react";
import { useSwipeDown } from "../ui/useSwipeDown";
import { Avatar, Button, IconButton, Segmented } from "../ui";
import { tick } from "../haptics";
import { countWith, people, projects, resetFilter, setFilter, useFilter, type Kind, type Term } from "../data/filters";
import { plural } from "../data/content";
import { PROJECTS } from "./NewTaskSheet";
import { hasAccountLaunch } from "../api/mailBoard";

const TERMS: Term[] = ["today", "week", "any"];
const KINDS: Kind[] = ["all", "project", "assign"];
/** «Показать 1 задачу / 2 задачи / 5 задач» — винительный падеж */
const showLabel = (n: number) => `Показать ${n} ${n % 10 === 1 && n % 100 !== 11 ? "задачу" : plural(n).split(" ")[1]}`;
const initials = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** Шторка «Фильтр» в Тасках: срок, тип, ответственный, проект — то, что задаётся задаче в форме «Новая задача». */
export function FilterSheet({ onClose }: { onClose: () => void }) {
  const f = useFilter();
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = () => { setClosing(true); setTimeout(onClose, 200); };
  useSwipeDown(box, onClose);
  const total = countWith(f);
  return (
    <div className={`sheet-layer${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Фильтр">
      <button type="button" className="sheet-scrim" aria-label="Закрыть" onClick={close} />
      <div className="sheet flt" ref={box}>
        <span className="sheet__handle" />
        <div className="nt-header">
          <h2 className="t-title-l">Фильтр</h2>
          <IconButton icon="close" label="Закрыть" onClick={close} />
        </div>

        <div className="nt-section">
          <span className="t-overline c-tertiary">Срок</span>
          <Segmented options={["Сегодня", "Неделя", "Любой"]} index={TERMS.indexOf(f.term)} onChange={(i) => setFilter({ term: TERMS[i] })} />
        </div>

        <div className="nt-section">
          <span className="t-overline c-tertiary">Тип</span>
          <Segmented options={["Все", "По проекту", "Поручения"]} index={KINDS.indexOf(f.kind)}
            onChange={(i) => setFilter({ kind: KINDS[i], project: KINDS[i] === "assign" ? null : f.project })} />
        </div>

        <div className="nt-section">
          <span className="t-overline c-tertiary">Ответственный</span>
          <div className="flt-people">
            {people().map((name) => {
              const on = f.person === name;
              return (
                <button key={name} type="button" className={`flt-person${on ? " is-on" : ""}${f.person && !on ? " is-dim" : ""}`} aria-pressed={on}
                  onClick={() => { tick(); setFilter({ person: on ? null : name }); }}>
                  <span className="flt-person__ring"><Avatar initials={initials(name)} /></span>
                  <span className="t-caption">{name.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {f.kind !== "assign" && (
          <div className="nt-section">
            <span className="t-overline c-tertiary">Проект</span>
            <div className="flt-scroll">
              {[null, ...(hasAccountLaunch ? projects() : PROJECTS.map((p) => p.name))].map((p) => (
                <button key={p ?? "all"} type="button" className={`nt-chip t-body-m-medium${f.project === p ? " is-on" : ""}`}
                  onClick={() => { tick(); setFilter({ project: p, kind: p ? "project" : f.kind }); }}>{p ?? "Все"}</button>
              ))}
            </div>
          </div>
        )}

        <div className="flt-actions">
          <Button label="Сбросить" variant="secondary" onClick={() => { tick(); resetFilter(); }} />
          <Button label={total ? showLabel(total) : "Ничего не найдено"} fill onClick={close} />
        </div>
      </div>
    </div>
  );
}

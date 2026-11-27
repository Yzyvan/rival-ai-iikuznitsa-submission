import { useRef, useState } from "react";
import { useSwipeDown } from "../ui/useSwipeDown";
import { sheets } from "../data/sheets";
import { Button, DraftCard, Status, Tags, VilarMessage } from "../ui";

/** Шторка поверх экрана. Закрывается по затемнению и по кнопке; действие может показать тост или увести на экран. */
export function SheetView({ id, onAction }: { id: string; onAction: (to: string) => void }) {
  const s = sheets[id];
  const [closing, setClosing] = useState(false);
  const run = (to: string) => { setClosing(true); setTimeout(() => onAction(to), 200); };
  const box = useRef<HTMLDivElement>(null);
  useSwipeDown(box, () => onAction("close"));   // свайп вниз — закрыть
  if (!s) return null;
  return (
    <div className={`sheet-layer${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={s.title}>
      <button type="button" className="sheet-scrim" aria-label="Закрыть" onClick={() => run("close")} />
      <div className="sheet" ref={box}>
        <span className="sheet__handle" />
        <div className="sheet__head">
          {s.status && <Status label={s.status[0]} type={s.status[1]} tone={s.status[2]} />}
          <h2 className={s.quote ? "t-title-m" : "t-title-l"}>{s.title}</h2>
          {s.tags && <Tags items={s.tags} />}
        </div>
        {s.msg && <VilarMessage text={s.msg} />}
        {s.draft && <DraftCard caption="Уйдёт от вашего имени" text={s.draft} />}
        <div className="sheet__actions">
          {s.actions.map(([label, style, to]) => <Button key={label} label={label} variant={style} fill onClick={() => run(to)} />)}
        </div>
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import { useSwipeDown } from "../ui/useSwipeDown";
import type { SheetData } from "../data/sheets";
import { Button, DraftCard, Status, Tags, VilarMessage } from "../ui";

/** Шторка поверх экрана. Закрывается по затемнению и по кнопке; действие может показать тост или увести на экран. */
export function SheetView({ sheet: s, onAction, onDecision, children }: { children?: React.ReactNode; sheet: SheetData; onAction: (to: string) => void; onDecision?: (to: string) => Promise<void> }) {
  const [closing, setClosing] = useState(false);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const run = async (to: string) => {
    if (busy.current) return;
    if (onDecision && to !== "close") {
      busy.current = true; setSaving(true); setError("");
      try { await onDecision(to); }
      catch (e) {
        busy.current = false; setSaving(false);
        setError(e instanceof Error ? e.message : "Не удалось сохранить выбор.");
        return;
      }
    }
    setClosing(true); setTimeout(() => onAction(to), 200);
  };
  const box = useRef<HTMLDivElement>(null);
  useSwipeDown(box, () => { if (!busy.current) onAction("close"); });   // свайп вниз — закрыть
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
        {children}
        {s.msg && <VilarMessage text={s.msg} />}
        {s.draft && <DraftCard caption="Уйдёт от вашего имени" text={s.draft} />}
        {error && <p role="alert" className="t-body-m">{error}</p>}
        <div className="sheet__actions" aria-busy={saving}>
          {s.actions.map(([label, style, to]) => <Button key={label} label={label} variant={style} fill onClick={() => run(to)} />)}
        </div>
      </div>
    </div>
  );
}

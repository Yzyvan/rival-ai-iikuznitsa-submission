import { useRef, useState } from "react";
import { Button, Icon, IconButton, VilarHint } from "../ui";
import { useSwipeDown } from "../ui/useSwipeDown";
import { tick } from "../haptics";
import { hasAccountLaunch } from "../api/mailBoard";

/* Шторка «Новый срок»: свой выбор дня и времени (без системных пикеров) — для «Перенести срок» и «Другая дата».
   Сначала день (Сегодня / Завтра / пятница или календарь), потом время; кнопка — когда выбраны оба. */

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_TITLE = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const TODAY = hasAccountLaunch ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(2026, 11, 7);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const TIMES = ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];
/** «Пт, 11 дек» */
export const shortDate = (d: Date) => `${WD[d.getDay()][0].toUpperCase()}${WD[d.getDay()][1]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
const dayLabel = (d: Date) => (same(d, TODAY) ? "Сегодня" : same(d, addDays(TODAY, 1)) ? "Завтра" : shortDate(d));

export function PickDateSheet({ title, subtitle, action = "Перенести", hint, onPick, onClose }: {
  title: string; subtitle?: string; action?: string; hint?: string;
  onPick: (date: Date, time: string) => void; onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [day, setDay] = useState<Date | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [weekStart, setWeekStart] = useState(TODAY);
  const box = useRef<HTMLDivElement>(null);
  useSwipeDown(box, onClose);
  const close = (then?: () => void) => { setClosing(true); setTimeout(() => { onClose(); then?.(); }, 200); };

  const days = [TODAY, addDays(TODAY, 1), addDays(TODAY, 4)];
  const chips = !day || days.some((d) => same(d, day)) ? days : [...days.slice(0, 2), day];
  const quick = ["12:00", "15:00", "18:00"];

  return (
    <div className={`sheet-layer${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet-scrim" aria-label="Закрыть" onClick={() => close()} />
      <div className="sheet nt-plain" ref={box}>
        <span className="sheet__handle" />
        <div className="nt-header">
          <div className="stack" style={{ gap: 4 }}>
            <h2 className="t-title-l">{title}</h2>
            {subtitle && <span className="t-body-m c-secondary">{subtitle}</span>}
          </div>
          <IconButton icon="close" label="Закрыть" onClick={() => close()} />
        </div>

        <div className="nt-section">
          <span className="t-overline c-tertiary">День</span>
          <div className="nt-chips">
            {chips.map((d) => <button key={d.toDateString()} type="button" className={`nt-chip t-body-m-medium${day && same(d, day) ? " is-on" : ""}`} onClick={() => { tick(); setDay(d); }}>{dayLabel(d)}</button>)}
            <button type="button" className={`nt-chip nt-chip--icon${picker ? " is-on" : ""}`} aria-label="Другая дата" onClick={() => { tick(); setPicker((v) => !v); }}><Icon name="calendar" size={20} /></button>
          </div>
          {picker && (
            <div className="nt-picker nt-reveal">
              <div className="nt-picker__head">
                <span className="t-body-m-medium">{MONTHS_TITLE[addDays(weekStart, 3).getMonth()]} {addDays(weekStart, 3).getFullYear()}</span>
                <span className="row" style={{ gap: 8 }}>
                  <IconButton icon="chevron-left" size={36} label="Предыдущая неделя" onClick={() => setWeekStart((w) => addDays(w, -7))} />
                  <IconButton icon="chevron-right" size={36} label="Следующая неделя" onClick={() => setWeekStart((w) => addDays(w, 7))} />
                </span>
              </div>
              <div className="nt-week">
                {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => (
                  <button key={d.toDateString()} type="button" className={`nt-day${day && same(d, day) ? " is-on" : ""}${d.getDay() === 0 || d.getDay() === 6 ? " is-off" : ""}`} onClick={() => { tick(); setDay(d); }}>
                    <span className="t-caption">{WD[d.getDay()]}</span>
                    <span className="t-body-l">{d.getDate()}</span>
                    <span className={`nt-day__dot${same(d, TODAY) ? " is-today" : ""}`} />
                  </button>
                ))}
              </div>
              {day && (
                <>
                  <span className="t-overline c-tertiary">Время</span>
                  <div className="nt-times">
                    {TIMES.map((t) => <button key={t} type="button" className={`nt-chip nt-chip--surface t-body-m-medium${t === time ? " is-on" : ""}`} onClick={() => { tick(); setTime(t); }}>{t}</button>)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {day && !picker && (
          <div className="nt-section nt-reveal">
            <span className="t-overline c-tertiary">Время</span>
            <div className="nt-chips">
              {quick.map((t) => <button key={t} type="button" className={`nt-chip t-body-m-medium${t === time ? " is-on" : ""}`} onClick={() => { tick(); setTime(t); }}>{t}</button>)}
              <button type="button" className={`nt-chip nt-chip--icon${time && !quick.includes(time) ? " is-on" : ""}`} aria-label="Другое время" onClick={() => { tick(); setPicker(true); }}><Icon name="clock" size={20} /></button>
            </div>
          </div>
        )}

        {day && time && (
          <div className="nt-final nt-reveal">
            {hint && <VilarHint text={hint} />}
            <Button label={`${action} на ${shortDate(day).split(", ")[1]}, ${time}`} fill onClick={() => close(() => onPick(day, time))} />
          </div>
        )}
      </div>
    </div>
  );
}

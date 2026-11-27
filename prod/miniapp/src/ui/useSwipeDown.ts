import { useEffect, useRef, type RefObject } from "react";

/** Шторка закрывается свайпом вниз: едет за пальцем, затемнение бледнеет;
    утянул далеко или смахнул быстро — уезжает вниз и закрывается, иначе возвращается на место.
    Тянуть можно за любое место, когда содержимое шторки прокручено до верха. */
export function useSwipeDown(sheet: RefObject<HTMLElement>, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const scrim = el.parentElement?.querySelector<HTMLElement>(".sheet-scrim") ?? null;
    let y0 = 0, dy = 0, tracking = false, dragging = false, lastY = 0, lastT = 0, v = 0;

    const set = (y: number, animate: boolean) => {
      el.style.animation = "none";   // анимация появления держит transform — снимаем, чтобы шторка ехала за пальцем
      el.style.transition = animate ? "transform 240ms cubic-bezier(0.25, 1, 0.5, 1), filter 240ms ease" : "none";
      el.style.transform = y ? `translateY(${y}px)` : "";
      el.style.filter = y ? `blur(${Math.min(20, (y / el.offsetHeight) * 20).toFixed(1)}px)` : "";   // чем ниже ушла, тем сильнее размыта (до 20 px)
      if (scrim) { scrim.style.animation = "none"; scrim.style.transition = animate ? "opacity 240ms ease" : "none"; scrim.style.opacity = String(Math.max(0, 1 - y / el.offsetHeight)); }
    };
    const start = (y: number) => { y0 = lastY = y; lastT = performance.now(); dy = 0; v = 0; tracking = true; dragging = false; };
    const move = (y: number, e?: Event) => {
      if (!tracking) return;
      const d = y - y0;
      if (!dragging) {
        if (d > 6 && el.scrollTop <= 0) dragging = true;   // тянем вниз от верха — это свайп шторки
        else if (Math.abs(d) > 6) { tracking = false; return; }   // иначе — обычная прокрутка содержимого
        else return;
      }
      e?.cancelable && e.preventDefault();
      const now = performance.now();
      v = (y - lastY) / Math.max(1, now - lastT); lastY = y; lastT = now;
      dy = Math.max(0, d);
      set(dy, false);
    };
    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      dragging = false;
      if (dy > Math.min(120, el.offsetHeight / 3) || v > 0.6) {
        el.style.transition = "transform 220ms ease-in, filter 220ms ease-in";
        el.style.transform = `translateY(${el.offsetHeight + 40}px)`;
        el.style.filter = "blur(20px)";
        if (scrim) { scrim.style.transition = "opacity 220ms ease"; scrim.style.opacity = "0"; }
        setTimeout(() => dismiss.current(), 220);
      } else { set(0, true); setTimeout(() => { if (!tracking) { el.style.transition = ""; if (scrim) scrim.style.transition = ""; } }, 260); }   // вернули свою плавную высоту
    };

    const ts = (e: TouchEvent) => start(e.touches[0].clientY);
    const tm = (e: TouchEvent) => move(e.touches[0].clientY, e);
    const md = (e: PointerEvent) => { if (e.pointerType === "mouse" && e.button === 0) start(e.clientY); };
    const mm = (e: PointerEvent) => { if (e.pointerType === "mouse") move(e.clientY); };
    const mu = (e: PointerEvent) => { if (e.pointerType === "mouse") end(); };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("pointerdown", md);
    window.addEventListener("pointermove", mm);
    window.addEventListener("pointerup", mu);
    return () => {
      el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end);
      el.removeEventListener("pointerdown", md); window.removeEventListener("pointermove", mm); window.removeEventListener("pointerup", mu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

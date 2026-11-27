import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { NavContext, takePending } from "./nav";
import { watchForUpdates } from "./update";
import { defaultStage, glow, toasts, type StageId } from "./data/content";
import { TabBar, UndoToast, type TabId } from "./ui";
import { Preloader } from "./screens/Preloader";
import { Onboarding, needOnboarding } from "./screens/Onboarding";
import { Board } from "./screens/Board";
import { hasAccountLaunch } from "./api/mailBoard";
import { Tasks } from "./screens/Tasks";
import { Tasks as TrackerTasks, TaskBindingsProvider } from "../../../integrations/tracker/src";
import { trackerBindings } from "../../../integrations/tracker/transport/bindings";
import "../../../integrations/tracker/src/style.css";
const showTracker = new URLSearchParams(window.location.search).get("tracker") === "1";
const standBindings = { ...trackerBindings, priorities: undefined };
import { Stats } from "./screens/Stats";
import { SheetView } from "./screens/SheetView";
import { Protocol } from "./screens/Protocol";
import { TaskEdit } from "./screens/TaskEdit";
import { Delivery } from "./screens/Delivery";
import { Notifications } from "./screens/Notifications";
import { Profile } from "./screens/Profile";
import { NoAccess } from "./screens/NoAccess";
import { NewTaskSheet } from "./screens/NewTaskSheet";
import { FilterSheet } from "./screens/FilterSheet";
import { PickDateSheet, shortDate } from "./screens/PickDateSheet";
import { sheets } from "./data/sheets";
import { readDeepLink } from "./deeplink";

const nested: Record<string, () => JSX.Element> = hasAccountLaunch ? {
  notifications: () => <Notifications />,
  profile: () => <Profile />,
} : {
  protocol: () => <Protocol />, task: () => <TaskEdit />, delivery: () => <Delivery />, "delivery-done": () => <Delivery done />,
  notifications: () => <Notifications />, profile: () => <Profile />, "no-access": () => <NoAccess />,
};

type Layer = { id: string; origin?: { x: number; y: number }; from?: { el: HTMLElement; left: number; top: number } };
const REVEAL = new Set(["notifications", "profile"]);

export function App() {
  // ?skip — без прелоудера; ?open=sheet:dec1 или startapp=sheet-dec1 — сразу на нужный экран и шторку (см. deeplink.ts)
  const [deep] = useState(() => readDeepLink(nested, hasAccountLaunch, showTracker));
  const [loading, setLoading] = useState(!deep.skip);
  // первый вход: после прелоудера — регистрация на той же подложке (?onboarding — показать заново)
  const [onboard, setOnboard] = useState(() => needOnboarding(deep.skip, !!deep.sheet || deep.screens.length > 0 || !!deep.tab));
  const [tab, setTab] = useState<TabId>(deep.tab ?? "board");
  const [stage, setStage] = useState<StageId>(deep.stage ?? defaultStage);
  const selectStage = useCallback((next: StageId) => {
    setStage(next);
    if (hasAccountLaunch) {
      const url = new URL(window.location.href);
      url.searchParams.set("open", "board:" + next);
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  // вложенные экраны поверх раздела меню — стопкой, чтобы «назад» возвращал на предыдущий
  const [stack, setStack] = useState<Layer[]>(deep.screens.map((id) => ({ id })));
  const top = stack[stack.length - 1] ?? null;
  const stackRef = useRef(stack);
  stackRef.current = stack;
  // экраны, которые раскрываются кругом из кнопки (колокольчик, аватар) и схлопываются обратно в неё
  const tap = useRef({ x: 0, y: 0 });
  const tapped = useRef<{ el: HTMLElement; left: number; top: number } | null>(null);   // нажатая кнопка — её копия висит поверх фона, пока круг заливается
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const remember = (e: PointerEvent) => {
      const app = document.querySelector(".app")?.getBoundingClientRect();
      tap.current = { x: e.clientX - (app?.left ?? 0), y: e.clientY - (app?.top ?? 0) };
      const btn = (e.target as HTMLElement)?.closest?.("button") as HTMLElement | null;
      const r = btn?.getBoundingClientRect();
      tapped.current = btn && r ? { el: btn, left: r.left - (app?.left ?? 0), top: r.top - (app?.top ?? 0) } : null;
    };
    window.addEventListener("pointerdown", remember, true);
    return () => window.removeEventListener("pointerdown", remember, true);
  }, []);
  const [sheet, setSheet] = useState<string | null>(deep.sheet ?? null);
  const [toast, setToast] = useState<{ id: string; key: number; text?: string } | null>(null);
  // «Перенести срок»: шторка выбора даты и времени, потом тост с выбранной датой
  const [pick, setPick] = useState<{ toast: string; about?: string } | null>(null);
  const sheetRef = useRef<string | null>(null);
  sheetRef.current = sheet;

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    try { tg?.ready(); tg?.expand(); tg?.setHeaderColor?.("#000000"); tg?.setBackgroundColor?.("#000000"); } catch { /* вне Telegram */ }
    // во весь экран, без шапки «Vilar · мини-приложение» (Telegram 8.0+); свайп вниз не сворачивает приложение
    try { if (tg?.isVersionAtLeast?.("8.0")) tg.requestFullscreen(); } catch { /* старый клиент — остаётся expand */ }
    try { tg?.disableVerticalSwipes?.(); } catch { /* старый клиент */ }
    // в полноэкранном режиме дата на Доске уходит в полосу кнопок Telegram
    const mark = () => document.documentElement.classList.toggle("tg-full", !!tg?.isFullscreen && (tg?.contentSafeAreaInset?.top ?? 0) > 0);
    mark();
    for (const e of ["fullscreenChanged", "contentSafeAreaChanged", "safeAreaChanged"]) try { tg?.onEvent?.(e, mark); } catch { /* старый клиент */ }
    watchForUpdates();   // новая сборка на сервере → перезагрузка при возвращении в мини-апп
  }, []);

  const nav = useCallback((target: string) => {
    // «back», «home» — без двоеточия; у шторок id сам может содержать «:» (авто-шторки задач)
    const cut = target.indexOf(":"), kind = cut < 0 ? target : target.slice(0, cut), id = cut < 0 ? "" : target.slice(cut + 1);
    if (kind === "sheet" && (!hasAccountLaunch || id === "help" || (tab === "tasks" && !showTracker))) setSheet(id);
    else if (kind === "pick") { setPick({ toast: id, about: sheetRef.current ? sheets[sheetRef.current]?.title : undefined }); setSheet(null); }
    else if (kind === "toast") { setSheet(null); setToast({ id, key: Date.now() }); }
    else if (kind === "screen") { setSheet(null); setStack((s) => [...s, { id, origin: REVEAL.has(id) ? { ...tap.current } : undefined, from: REVEAL.has(id) ? tapped.current ?? undefined : undefined }]); }
    else if (kind === "replace") setStack((s) => [...s.slice(0, -1), { id }]);
    else if (kind === "back") {
      const s = stackRef.current;
      if (s[s.length - 1]?.origin) { setClosing(true); setTimeout(() => { setClosing(false); setStack((x) => x.slice(0, -1)); }, 380); }
      else setStack((x) => x.slice(0, -1));
    }
    else if (kind === "home") { setSheet(null); setStack([]); }
    else if (kind === "board") { setSheet(null); setStack([]); setTab("board"); selectStage(id as StageId); }
    else if (kind === "tab") { setSheet(null); setStack([]); setTab(id as TabId); }
    else setSheet(null);
  }, [selectStage, tab]);

  const done = useCallback(() => setLoading(false), []);
  // фон Telegram: пока идёт прелоудер — в цвет градиента (без чёрной вспышки), потом — чёрный, как у приложения
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    const c = loading || onboard ? glow.base : "#000000";
    try { tg?.setBackgroundColor?.(c); tg?.setHeaderColor?.(c); } catch { /* вне Telegram */ }
    document.documentElement.style.background = c;
  }, [loading, onboard]);
  const changeTab = (t: TabId) => { setTab(t); if (t === "board") selectStage(defaultStage); };

  return (
    <NavContext.Provider value={nav}>
      <div className="app">
        {/* раздел меню рисуется всегда — вложенный экран ложится сверху (и может раскрыться кругом из кнопки) */}
        {tab === "board" && <Board stage={stage} onStage={selectStage} />}
        {tab === "tasks" && (showTracker
          ? <TaskBindingsProvider bindings={standBindings}><TrackerTasks /></TaskBindingsProvider>
          : <Tasks />)}
        {tab === "stats" && <Stats />}
        <TabBar active={tab} onChange={changeTab} />
        {top && nested[top.id] && (
          <div key={stack.length + top.id} className={`nested${top.origin ? " nested--reveal" : ""}${top.origin && closing ? " is-closing" : ""}`}
               style={top.origin ? ({ "--rx": `${top.origin.x}px`, "--ry": `${top.origin.y}px` } as CSSProperties) : undefined}>
            {nested[top.id]()}
            {top.from && !closing && (
              <div className="reveal-ghost" aria-hidden="true" style={{ left: top.from.left, top: top.from.top }}
                   ref={(el) => { if (el && !el.firstChild && top.from) el.appendChild(top.from.el.cloneNode(true)); }} />
            )}
          </div>
        )}
        {pick && (
          <PickDateSheet title="Новый срок" subtitle={pick.about} hint="исполнитель получит уведомление от вашего имени"
            onClose={() => setPick(null)}
            onPick={(d, t) => { setPick(null); setToast({ id: pick.toast, key: Date.now(), text: `Срок перенесён на ${shortDate(d).split(", ")[1]}, ${t} — исполнитель уведомлён` }); }} />
        )}
        {sheet === "newtask" && <NewTaskSheet onClose={() => setSheet(null)} onToast={(id) => setToast({ id, key: Date.now() })} />}
        {sheet === "filter" && <FilterSheet onClose={() => setSheet(null)} />}
        {sheet && sheet !== "newtask" && sheet !== "filter" && <SheetView key={sheet} sheet={sheets[sheet]} onAction={nav} />}
        {/* любое действие пользователя можно отменить: все тосты — с отсчётом */}
        {toast && toasts[toast.id] && <UndoToast key={toast.key} text={toast.text ?? toasts[toast.id].text} onCommit={() => { takePending()?.(); setToast(null); }} onCancel={() => { takePending(); setToast(null); }} />}
        {onboard && <Onboarding active={!loading} onDone={() => setOnboard(false)} />}
        {loading && <Preloader onDone={done} toBoard={!onboard} />}
      </div>
    </NavContext.Provider>
  );
}

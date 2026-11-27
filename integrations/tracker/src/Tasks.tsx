import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, TaskCard, buzz, tick } from "./controls";
import { columnLabels, dateLabel, type Column, type TaskRecord } from "./model";
import { useTracker } from "./bindings";
import { CreateTaskSheet, TaskDetail } from "./TaskForms";

const codes = Object.keys(columnLabels) as Column[];
const colors: Record<Column, string> = {
  overdue: "#ff5379",
  in_progress: "#eee65a",
  new: "#ff8fa8",
  done: "#3deb8c",
};
type Task = { title: string; date: string; assignee: string; record: TaskRecord };
function byDate(a: Task, b: Task) {
  const key = (t: TaskRecord) => (t.dueDate || "9999-12-31") + (t.dueTime || "23:59");
  return key(a.record).localeCompare(key(b.record)) || a.record.id.localeCompare(b.record.id);
}
const LONG_PRESS_MS = 350; // столько держать палец, чтобы поднять задачу
const MOVE_TOLERANCE = 8; // сдвиг пальца до срабатывания — значит, человек листает, а не берёт задачу
const FLIP = 0.3; // сдвинул поднятую задачу на 30% ширины колонки — лента переезжает к соседней

type Drag = {
  task: Task;
  from: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
  over: number | null;
};

/** Таски: канбан. Колонки листаются по одной, с отсечкой («буп»). Задачу можно зажать и перенести в другую колонку. */
export function Tasks() {
  const bindings = useTracker();
  const [selected, setSelected] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState(""),
    [assignee, setAssignee] = useState(""),
    [column, setColumn] = useState("");
  const list = bindings.useList(query.trim(), assignee, column);
  const people = bindings.usePeople(filterOpen);
  const [createColumn, setCreateColumn] = useState<Column | null>(null);
  const [created, setCreated] = useState<TaskRecord | null>(null);
  const [notice, setNotice] = useState("");
  const write = bindings.useActions();
  const cols = useMemo(
    () =>
      codes.map((code) => ({
        title: columnLabels[code],
        glow: colors[code],
        dot: colors[code],
        tasks: (list.data?.rows ?? [])
          .filter((t) => t.column === code)
          .map((record) => ({
            record,
            title: record.title,
            assignee: record.assigneeName,
            date: dateLabel(record),
          }))
          .sort(byDate),
      })),
    [list.data],
  );
  useEffect(() => {
    const latest = created && list.data?.rows.find((row) => row.id === created.id);
    if (latest && created && latest.version !== created.version) setCreated(null);
  }, [created, list.data]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const scroller = useRef<HTMLDivElement>(null);

  // Плавная перестановка (FLIP): после каждой отрисовки карточки, которые сдвинулись внутри колонки,
  // стартуют со старого места и доезжают до нового; новые — мягко проявляются. Позиции — относительно колонки,
  // поэтому горизонтальное листание ленты не анимируется.
  const flipPrev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const next = new Map<string, number>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const key = el.dataset.flip!,
        top = el.offsetTop;
      next.set(key, top);
      const was = flipPrev.current.get(key);
      if (was === undefined) {
        if (flipPrev.current.size && !key.endsWith(":drop"))
          el.animate(
            [
              { opacity: 0, transform: "scale(0.96)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 260, easing: "cubic-bezier(0.25, 1, 0.5, 1)" },
          );
        return;
      }
      const dy = was - top;
      if (Math.abs(dy) > 0.5)
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
          duration: 280,
          easing: "cubic-bezier(0.25, 1, 0.5, 1)",
        });
    });
    flipPrev.current = next;
  });
  const colRefs = useRef<(HTMLElement | null)[]>([]);
  const press = useRef<{ timer: number; pointerId: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const current = useRef(0);
  const lastEdge = useRef(0);
  const anchorX = useRef<number | null>(null); // откуда считаем сдвиг для перелистывания при переносе
  const flipTo = useRef<number | null>(null); // куда уже листаем — лента может ещё ехать

  // колонка, чей центр ближе всего к центру экрана (крайние встают к краю, средние — по центру)
  const nearest = () => {
    const el = scroller.current;
    if (!el) return 0;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0,
      dist = Infinity;
    colRefs.current.forEach((c, i) => {
      if (c) {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < dist) {
          dist = d;
          best = i;
        }
      }
    });
    return best;
  };
  const goTo = (i: number) => {
    const el = scroller.current,
      c = colRefs.current[Math.max(0, Math.min(cols.length - 1, i))];
    if (!el || !c) return;
    el.scrollTo({ left: c.offsetLeft + c.offsetWidth / 2 - el.clientWidth / 2, behavior: "smooth" }); // точное место доведёт прилипание
  };

  useEffect(() => {
    if (column) goTo(codes.indexOf(column as Column));
  }, [column]);

  // отсечка при листании: как только лента встала на новую колонку — «буп»
  const onScroll = () => {
    const i = nearest();
    if (i !== current.current) {
      current.current = i;
      tick();
    }
    // во время переноса лента едет под неподвижным пальцем — подсвечиваем колонку, которая теперь под ним
    const d = dragRef.current;
    if (d) {
      let over: number | null = null;
      colRefs.current.forEach((c, k) => {
        if (c) {
          const r = c.getBoundingClientRect();
          if (d.x >= r.left && d.x <= r.right) over = k;
        }
      });
      if (over !== null && over !== d.over) setDrag({ ...d, over });
    }
  };

  /* ── перетаскивание ── */
  const cancelPress = () => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  };

  // Before a long press lifts a card, releasing or moving outside it must also cancel the timer.
  useEffect(() => {
    const moved = (e: PointerEvent) => {
      const p = press.current;
      if (p && p.pointerId === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE)
        cancelPress();
    };
    const ended = (e: PointerEvent) => {
      if (e.pointerId === press.current?.pointerId) cancelPress();
    };
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", ended);
    window.addEventListener("pointercancel", ended);
    window.addEventListener("blur", cancelPress);
    return () => {
      cancelPress();
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", ended);
      window.removeEventListener("pointercancel", ended);
      window.removeEventListener("blur", cancelPress);
    };
  }, []);

  const startPress = (e: React.PointerEvent, task: Task, from: number) => {
    if (
      !e.isPrimary ||
      e.button !== 0 ||
      write.busy ||
      !task.record.moveTargets.some((c) => c !== task.record.column)
    )
      return;
    const el = e.currentTarget as HTMLElement;
    const x = e.clientX,
      y = e.clientY;
    cancelPress();
    press.current = {
      pointerId: e.pointerId,
      x,
      y,
      timer: window.setTimeout(() => {
        press.current = null;
        const r = el.getBoundingClientRect();
        setDrag({ task, from, x, y, dx: x - r.left, dy: y - r.top, w: r.width, over: from });
        anchorX.current = x; // сдвиг для перелистывания считаем от точки, где взяли задачу
        suppressClick.current = true;
        buzz("medium");
      }, LONG_PRESS_MS),
    };
  };
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) {
      anchorX.current = null;
      flipTo.current = null;
    }
  }, [dragging]); // новая задача — новая точка отсчёта

  useEffect(() => {
    if (!drag) return;
    const move = (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      let over: number | null = null;
      colRefs.current.forEach((c, i) => {
        if (c) {
          const r = c.getBoundingClientRect();
          if (x >= r.left && x <= r.right) over = i;
        }
      });
      if (over !== d.over && over !== null) tick();
      dragRef.current = { ...d, x, y, over };
      setDrag(dragRef.current);
      // сдвиг на 30% ширины колонки от точки, где взяли задачу (или от прошлого перелистывания) — листаем
      const colW =
        colRefs.current[current.current]?.getBoundingClientRect().width ?? scroller.current?.clientWidth ?? 0;
      const now = performance.now();
      const target = flipTo.current ?? current.current;
      if (over !== null && over !== target && now - lastEdge.current > 350) {
        // палец уже над соседней колонкой (там появилась полоска вставки) — ставим её по центру
        lastEdge.current = now;
        anchorX.current = x;
        flipTo.current = over;
        goTo(over);
      } else if (colW && now - lastEdge.current > 350) {
        const shift = x - (anchorX.current ?? x);
        const dir = shift > colW * FLIP ? 1 : shift < -colW * FLIP ? -1 : 0;
        if (dir) {
          const to = Math.max(0, Math.min(cols.length - 1, (flipTo.current ?? current.current) + dir));
          lastEdge.current = now;
          anchorX.current = x;
          flipTo.current = to;
          goTo(to);
        }
      }
    };
    const drop = (x: number, y: number) => {
      const d0 = dragRef.current;
      // лента могла доехать уже после последнего движения пальца — колонку под пальцем считаем заново
      let under: number | null = null;
      if (d0)
        colRefs.current.forEach((c, i) => {
          if (!c) return;
          const r = c.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) under = i;
        });
      dragRef.current = null;
      const d = d0 && { ...d0, over: under as number | null };
      if (d && d.over !== null && d.over !== d.from) {
        const to = d.over;
        const record = d.task.record;
        setNotice("");
        if (record.moveTargets.includes(codes[to])) {
          void write.change(record.id, record.version, "move", { column: codes[to] }, () =>
            setNotice("Задача перемещена."),
          );
        } else setNotice("Переход в эту колонку недоступен.");
      }
      buzz("light");
      setDrag(null);
      setTimeout(() => {
        suppressClick.current = false;
      }, 50);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") move(e.clientX, e.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") drop(e.clientX, e.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) drop(t.clientX, t.clientY);
    };
    const cancelDrag = () => {
      dragRef.current = null;
      setDrag(null);
      suppressClick.current = false;
    };
    const onPointerCancel = (e: PointerEvent) => {
      // A browser may cancel its synthetic touch pointer while native touch events continue.
      if (e.pointerType !== "touch") cancelDrag();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("touchmove", onTouchMove, { passive: false }); // пока задача в руке — страница не листается
    window.addEventListener("pointerup", onUp);
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", cancelDrag);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", cancelDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", cancelDrag);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", cancelDrag);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  return (
    <div className="screen">
      <div className="scroll">
        <header className="header">
          <span className="header__title t-body-l">Все задачи</span>
          {
            <div className="row">
              <button type="button" className="btn btn--ghost btn--s" onClick={list.refresh}>
                Обновить
              </button>
              <IconButton label="Фильтр" onClick={() => setFilterOpen(!filterOpen)} />
            </div>
          }
        </header>
        {filterOpen && (
          <div className="live-task-fields live-task-filter">
            <label>
              Поиск задач
              <input type="search" maxLength={512} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label>
              Исполнитель фильтра
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Все исполнители</option>
                {people.data?.rows.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Колонка фильтра
              <select value={column} onChange={(e) => setColumn(e.target.value)}>
                <option value="">Все колонки</option>
                {codes.map((code) => (
                  <option key={code} value={code}>
                    {columnLabels[code]}
                  </option>
                ))}
              </select>
            </label>
            {people.error && (
              <p role="alert">
                {people.error} <button onClick={people.refresh}>Повторить</button>
              </p>
            )}
            {(query || assignee || column) && (
              <button
                type="button"
                className="btn btn--secondary btn--s"
                onClick={() => {
                  setQuery("");
                  setAssignee("");
                  setColumn("");
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        )}
        {
          <div className="live-task-feedback">
            {list.error && <p role="alert">{list.error}</p>}
            {!list.data && !list.error && <p role="status">Загружаем задачи…</p>}
            {list.data?.rows.length === 0 && (
              <p role="status">{query || assignee || column ? "Задачи не найдены" : "Пока нет задач"}</p>
            )}
            {write.error && <p role="alert">{write.error}</p>}
            {notice && <p role="status">{notice}</p>}
            {created && (
              <div className="live-task-undo">
                <span>Создана задача «{created.title}»</span>
                <button
                  disabled={write.busy}
                  className="btn btn--secondary btn--s"
                  onClick={() => {
                    void write.undo(created, () => {
                      setCreated(null);
                      setNotice("Создание отменено.");
                    });
                  }}
                >
                  Отменить создание
                </button>
              </div>
            )}
          </div>
        }
        <div
          ref={scroller}
          className={`hscroll kanban pad-for-bar${drag ? " is-dragging" : ""}`}
          style={{ paddingTop: 16 }}
          onScroll={onScroll}
        >
          <div className="columns" style={{ width: "max-content" }}>
            {cols.map((c, ci) => {
              // куда встанет задача: место по сроку среди остальных задач колонки
              const others = drag ? c.tasks.filter((t) => t.record.id !== drag.task.record.id) : c.tasks;
              const slot =
                drag && drag.over === ci
                  ? (() => {
                      const i = others.findIndex((t) => byDate(drag.task, t) < 0);
                      return i < 0 ? others.length : i;
                    })()
                  : -1;
              let k = 0;
              return (
                <section
                  key={c.title}
                  data-column={codes[ci]}
                  ref={(el) => (colRefs.current[ci] = el)}
                  className={`column${drag && drag.over === ci ? " is-over" : ""}`}
                  style={{ ["--glow" as string]: c.glow, ["--glow-dot" as string]: c.dot }}
                >
                  <div className="column__glow" />
                  <div className="column__head">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="column__dot" />
                      <span className="t-title-s">{c.title}</span>
                    </div>
                    <span className="t-body-m c-secondary">{c.tasks.length}</span>
                  </div>
                  {list.data?.showCreate && <Button label="Добавить" onClick={() => setCreateColumn(codes[ci])} />}
                  {c.tasks.map((t) => {
                    const ghost = drag?.task.record.id === t.record.id;
                    const line =
                      !ghost && slot === k ? (
                        <span key="drop" data-flip={`${ci}:drop`} className="drop-line" />
                      ) : null;
                    if (!ghost) k++;
                    return [
                      line,
                      <div
                        key={t.record.id}
                        data-task-id={t.record.id}
                        data-flip={`${ci}:${t.record.id}`}
                        className={`task-slot${ghost ? " is-ghost" : ""}`}
                        onPointerDown={(e) => startPress(e, t, ci)}
                        onContextMenu={(e) => e.preventDefault()}
                      >
                        <TaskCard
                          date={t.date}
                          title={t.title}
                          assignee={t.assignee}
                          onClick={() => {
                            if (!suppressClick.current) setSelected(t.record.id);
                          }}
                        />
                      </div>,
                    ];
                  })}
                  {slot === others.length && <span data-flip={`${ci}:drop`} className="drop-line" />}
                </section>
              );
            })}
          </div>
        </div>
      </div>
      {selected && <TaskDetail id={selected} onClose={() => setSelected(null)} />}
      {createColumn && (
        <CreateTaskSheet
          column={createColumn}
          onClose={() => setCreateColumn(null)}
          onCreated={(t) => {
            setCreated(t);
            setNotice("");
            write.clearError();
            setCreateColumn(null);
          }}
        />
      )}
      {drag &&
        createPortal(
          <div className="drag-float" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
            <div className="drag-float__card">
              <TaskCard date={drag.task.date} title={drag.task.title} assignee={drag.task.assignee} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

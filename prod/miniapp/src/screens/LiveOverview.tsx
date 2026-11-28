// Этап «Согласование» после входа: результаты, которые исполнители сдали на проверку (GET /tracker/api/board).
// Если проверяющий — сам руководитель, результат ждёт его решения: красная строка сверху и кнопки в шторке.
// Если проверяет кто-то другой — строка внизу, только для чтения.
import { createPortal } from "react-dom";
import { notifyTasks, trackerPost, useTaskRead } from "../api/tracker";
import type { SheetData } from "../data/sheets";
import { ListRow, Section, Toast } from "../ui";
import { onToastCommit, useNav } from "../nav";
import { SheetView } from "./SheetView";
import { useEffect, useState } from "react";

type Approval = { step_id: string; title: string; assignee_name: string; reviewer_name: string; result_version: number };

export function useApprovals(active: boolean, selfName?: string) {
  const read = useTaskRead<{ rows: Approval[] }>(active ? "board" : null);
  const rows = read.data?.rows;
  // пока своё имя не известно, считаем, что проверяет руководитель: лучше показать решение, чем спрятать
  const mine = rows?.filter((r) => !selfName || r.reviewer_name === selfName) ?? [];
  const others = rows?.filter((r) => selfName && r.reviewer_name !== selfName) ?? [];
  return { ...read, mine, others, /** сколько результатов ждут решения руководителя */ needs: rows ? mine.length : undefined };
}
type Approvals = ReturnType<typeof useApprovals>;

/** Строка: заголовок — название поручения · тег 1 — исполнитель, имя и фамилия · тег 2 — версия результата */
const rowOf = (r: Approval) => ({ title: r.title, subtitle: `${r.assignee_name} · версия ${r.result_version}` });

/** Красные строки шапки: результаты, которые ждут согласования руководителя */
export function ApprovalUrgent({ approvals, onOpen }: { approvals: Approvals; onOpen: (id: string) => void }) {
  return <>{approvals.mine.map((r) => <ListRow key={r.step_id} urgent {...rowOf(r)} status={["согласовать", "Решение", "Яркая"]} onClick={() => onOpen(r.step_id)} />)}</>;
}

/** Нижняя часть этапа: результаты, которые проверяет не руководитель, и шторка результата */
export function LiveApprovals({ approvals, opened, onOpen }: { approvals: Approvals; opened: string | null; onOpen: (id: string | null) => void }) {
  const nav = useNav();
  const { data, error, mine, others } = approvals;
  const selected = data?.rows.find((r) => r.step_id === opened);
  const isMine = !!selected && mine.includes(selected);
  const [note, setNote] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 2400); return () => clearTimeout(t); }, [note]);

  // Решение уходит после отсчёта тоста. Адреса согласования в трекере пока нет — см. design/front-contract-check.md.
  const decide = (r: Approval, to: string) => {
    onOpen(null);
    if (to === "close") return;
    onToastCommit(() => {
      trackerPost(`board/${encodeURIComponent(r.step_id)}/${to}`, { result_version: r.result_version })
        .then(notifyTasks, (e: Error) => setNote({ text: e.message, key: Date.now() }));
    });
    nav(to === "accept" ? "toast:t18" : "toast:t19");
  };
  const sheet = (r: Approval): SheetData => ({
    status: isMine ? ["ваше решение", "Решение", "Яркая"] : ["на проверке", "Нейтрально", "Темная"],
    title: r.title,
    tags: isMine ? [r.assignee_name, `версия ${r.result_version}`] : [r.assignee_name, `версия ${r.result_version}`, `проверяет ${r.reviewer_name}`],
    actions: isMine ? [["Согласовать", "primary", "accept"], ["Вернуть на доработку", "secondary", "rework"]] : [["Закрыть", "ghost", "close"]],
  });

  return <>
    {(error || !data) && <Section title="Поручения"><p role="status" className="t-body-m c-secondary">{error || "Загрузка…"}</p></Section>}
    {others.length > 0 && <Section title="На проверке у других">
      {others.map((r) => <ListRow key={r.step_id} {...rowOf(r)} status={["на проверке", "Нейтрально", "Темная"]} onClick={() => onOpen(r.step_id)} />)}
    </Section>}
    {note && <Toast key={note.key} type="Error" text={note.text} />}
    {selected && createPortal(
      <SheetView key={selected.step_id} sheet={sheet(selected)} onAction={(to) => decide(selected, to)} />,
      document.querySelector(".app")!,
    )}
  </>;
}

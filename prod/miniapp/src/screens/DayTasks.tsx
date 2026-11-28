// Поручения учебного дня на вкладке «Поручения» — в том порядке, в каком их отдал сервер (api/day.ts).
// Срок прошёл — красная строка в шапке этапа; остальные — в разделе «В работе». После перемотки дня порядок приходит новый.
// Нажатие на строку открывает шторку: состояние, исполнитель и срок, почему строка стоит на этом месте, ответ исполнителя.
import { createPortal } from "react-dom";
import type { Day, DayTask } from "../api/day";
import type { SheetData } from "../data/sheets";
import { IncomingMessage, ListRow, Section, type StatusSpec } from "../ui";
import { SheetView } from "./SheetView";

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** «до 10 дек»; срок прошёл — «было 10 дек» */
function dueText(due?: string, overdue?: boolean) {
  const m = due?.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${overdue ? "было" : "до"} ${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}` : undefined;
}
/** Статус есть только у строк, про которые сервер что-то сказал: срок прошёл или сдано. Тега «файл приложен» нет — сервер вложение не подтверждает */
const statusOf = (t: DayTask): StatusSpec | undefined => (t.done ? ["сдано", "Готово", "Яркая"] : t.overdue ? ["срок прошёл", "Решение", "Яркая"] : undefined);
const tagsOf = (t: DayTask) => [t.assignee, t.done ? undefined : dueText(t.due, t.overdue)].filter((x): x is string => !!x);
/** Теги строки: исполнитель и срок, если сервер их дал; иначе причина места в очереди (reason) */
const rowOf = (t: DayTask) => ({ title: t.title, subtitle: [...tagsOf(t), !t.assignee && !t.due && t.reason?.toLowerCase() !== statusOf(t)?.[0] ? t.reason : undefined].filter(Boolean).join(" · ") || undefined, status: statusOf(t) });

/** Красные строки: поручения, у которых срок прошёл, а ответа нет */
export function DayUrgent({ day, onOpen }: { day: Day | null; onOpen: (id: string) => void }) {
  return <>{day?.tasks.filter((t) => t.overdue && !t.done).map((t) => <ListRow key={t.id} urgent {...rowOf(t)} onClick={() => onOpen(t.id)} />)}</>;
}

/** Раздел «В работе»: остальные поручения дня, порядок — как у сервера; и шторка открытого поручения */
export function DayTasks({ day, opened, onOpen }: { day: Day | null; opened: string | null; onOpen: (id: string | null) => void }) {
  const rows = day?.tasks.filter((t) => !t.overdue || t.done) ?? [];
  const t = day?.tasks.find((x) => x.id === opened);
  const reply = day?.reply;
  const sheet = (x: DayTask): SheetData => ({
    status: statusOf(x) ?? ["в работе", "Нейтрально", "Темная"], title: x.title,
    tags: [x.assignee, dueText(x.due, x.overdue)].filter((value): value is string => !!value),
    msg: x.reason,
    actions: [["Закрыть", "ghost", "close"]],
  });
  return <>
    {rows.length > 0 && <Section title="В работе">{rows.map((x) => <ListRow key={x.id} {...rowOf(x)} onClick={() => onOpen(x.id)} />)}</Section>}
    {t && createPortal(
      <SheetView key={t.id} sheet={sheet(t)} onAction={() => onOpen(null)}>
        {reply?.taskId === t.id && <IncomingMessage name={t.assignee} text={reply.body} />}
      </SheetView>,
      document.querySelector(".app")!,
    )}
  </>;
}

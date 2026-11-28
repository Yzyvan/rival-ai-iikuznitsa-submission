// Поручения учебного дня на вкладке «Поручения» — в том порядке, в каком их отдал сервер (api/day.ts).
// Срок прошёл — красная строка в шапке этапа; остальные — в разделе «В работе». После перемотки дня порядок приходит новый.
import type { Day, DayTask } from "../api/day";
import { ListRow, Section, type StatusSpec } from "../ui";

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** «до 10 дек»; срок прошёл — «было 10 дек» */
function dueText(due?: string, overdue?: boolean) {
  const m = due?.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${overdue ? "было" : "до"} ${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}` : undefined;
}
/** Статус есть только у строк, про которые сервер что-то сказал: срок прошёл или сдано. Тега «файл приложен» нет — сервер вложение не подтверждает */
const statusOf = (t: DayTask): StatusSpec | undefined => (t.done ? ["сдано", "Готово", "Яркая"] : t.overdue ? ["срок прошёл", "Решение", "Яркая"] : undefined);
/** Теги строки: исполнитель и срок, если сервер их дал; иначе причина места в очереди (reason) */
const rowOf = (t: DayTask) => ({ title: t.title, subtitle: [t.assignee, t.done ? undefined : dueText(t.due, t.overdue), !t.assignee && !t.due && t.reason?.toLowerCase() !== statusOf(t)?.[0] ? t.reason : undefined].filter(Boolean).join(" · ") || undefined, status: statusOf(t) });

/** Красные строки: поручения, у которых срок прошёл, а ответа нет */
export function DayUrgent({ day }: { day: Day | null }) {
  return <>{day?.tasks.filter((t) => t.overdue && !t.done).map((t) => <ListRow key={t.id} urgent {...rowOf(t)} />)}</>;
}

/** Раздел «В работе»: остальные поручения дня, порядок — как у сервера */
export function DayTasks({ day }: { day: Day | null }) {
  const rows = day?.tasks.filter((t) => !t.overdue || t.done) ?? [];
  if (!rows.length) return null;
  return <Section title="В работе">{rows.map((t) => <ListRow key={t.id} {...rowOf(t)} />)}</Section>;
}

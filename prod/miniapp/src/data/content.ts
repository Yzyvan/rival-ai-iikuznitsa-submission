// Демо-данные экранов. Тексты взяты из макетов Figma (страница Prod) один в один.
// Пока всё локально: бэкенд сюда не подключён.
import type { StatusSpec } from "../ui";

export type Row = { title: string; subtitle: string; status?: StatusSpec; value?: string; valueSub?: string; open?: string; /** ждёт действия пользователя — красная карточка */ urgent?: boolean };
export type StageId = "mail" | "approvals" | "meetings";

export const today = "Пн, 7 декабря";
export const userInitials = "ИП";   // пользователь в истории — Иван Петров

// Этапы доски. Порядок вкладок = порядок в этом списке: чтобы переставить этапы, достаточно поменять строки местами.
// Первый в списке открывается по умолчанию.
export const stages: { id: StageId; label: string; count: number }[] = [
  { id: "approvals", label: "Согласование", count: 8 },
  { id: "meetings", label: "Встречи", count: 4 },
  { id: "mail", label: "Почта", count: 7 },
];
export const defaultStage: StageId = stages[0].id;

type Board = { hero: { count: string; label: string; brand?: boolean }; urgent: Row[]; sections: { title: string; vilar?: boolean; rows: Row[] }[] };

export const boards: Record<StageId, Board> = {
  mail: {
    hero: { count: "3", label: "решения ждут вас сегодня" },
    urgent: [
      { title: "Перенос 400 тыс. ₽ в digital", subtitle: "Наталья Павлова · бюджет Q1", status: ["решение", "Решение", "Яркая"], open: "sheet:dec1" },
      { title: "Оффер аккаунт-менеджеру", subtitle: "Игорь Фёдоров · кадры", status: ["решение", "Решение", "Яркая"], open: "sheet:dec2" },
      { title: "Скидка 12% для «ТехноСтрой»", subtitle: "Ольга Смирнова · клиент", status: ["ответ сегодня", "Внимание", "Яркая"], open: "sheet:dec3" },
    ],
    sections: [{
      title: "Vilar решил сам", vilar: true, rows: [
        { title: "Запрос КП от «ТехноСтрой»", subtitle: "передал Ольге", status: ["делегировано", "Нейтрально", "Темная"], open: "sheet:del1" },
        { title: "Перенос 1:1 на 14:00", subtitle: "Ольга · согласовано", status: ["согласовано", "Готово", "Яркая"], open: "sheet:del2" },
        { title: "Приглашение на «Digital Sales»", subtitle: "передал Екатерине", status: ["делегировано", "Нейтрально", "Темная"], open: "sheet:del3" },
        { title: "Прогноз декабря — 94% плана", subtitle: "Ольга Смирнова · продажи", status: ["в сводке", "Нейтрально", "Темная"], open: "sheet:del4" },
      ],
    }],
  },
  approvals: {
    hero: { count: "2", label: "поручения просрочены", brand: true },
    urgent: [
      { title: "КП для «ТехноСтрой» на 40 лицензий", subtitle: "Ольга Смирнова · было 5 дек", status: ["просрочено", "Решение", "Яркая"], open: "sheet:task1" },
      { title: "Отчёт по e-com за ноябрь", subtitle: "Анна Волкова · было 6 дек", status: ["просрочено", "Решение", "Яркая"], open: "sheet:task2" },
    ],
    sections: [{
      title: "В работе", rows: [
        { title: "Сверить прогноз декабря с CRM", subtitle: "Алексей Новиков · до 8 дек", status: ["срок завтра", "Внимание", "Яркая"], open: "sheet:task3" },
        { title: "Креативы январской кампании", subtitle: "Дмитрий Козлов · до 12 дек", status: ["в срок", "Готово", "Яркая"], open: "sheet:task4" },
        { title: "Онбординг аккаунт-менеджера", subtitle: "Екатерина Соколова · до 15 дек", status: ["в срок", "Готово", "Яркая"], open: "sheet:task5" },
        { title: "Дорожная карта интеграции «Ромашка-Ритейл»", subtitle: "Мария Лебедева · до 10 дек", status: ["в срок", "Готово", "Яркая"], open: "sheet:task6" },
        { title: "План партнёрских мероприятий Q1", subtitle: "Сергей Морозов · до 21 дек", status: ["в срок", "Готово", "Яркая"], open: "sheet:task7" },
        { title: "Тезисы к совету директоров", subtitle: "Алексей Новиков · до 22 дек", status: ["в срок", "Готово", "Яркая"], open: "sheet:task8" },
      ],
    }],
  },
  meetings: {
    hero: { count: "2", label: "решения по встречам", brand: true },
    urgent: [
      { title: "Статус запуска «Ромашка-Ритейл»", subtitle: "11:00–11:30 · Павел, Мария", status: ["кто пойдёт?", "Решение", "Яркая"], open: "sheet:meet1" },
      { title: "Интеграция «Ромашка-Ритейл»", subtitle: "4 дек · v3 · 4 поручения", status: ["утвердить", "Решение", "Яркая"], open: "screen:protocol" },
    ],
    sections: [
      {
        title: "Предстоящие", rows: [
          { title: "Планёрка e-com", subtitle: "11:00–11:45 · Анна и команда", status: ["идёт Vilar", "Нейтрально", "Темная"], open: "sheet:meet2" },
          { title: "1:1 с Ольгой Смирновой", subtitle: "14:00–14:30 · было в 12:00", status: ["лично", "Нейтрально", "Темная"], open: "sheet:meet3" },
          { title: "Комитет по бюджету Q1", subtitle: "16:30–17:30 · 3 участника", status: ["лично", "Нейтрально", "Темная"], open: "sheet:meet4" },
        ],
      },
      {
        title: "Прошедшие", rows: [
          { urgent: true, title: "Бюджет digital-каналов", subtitle: "3 дек · v1 · нет исполнителя", status: ["уточнить", "Внимание", "Яркая"], open: "screen:protocol" },
          { title: "Критерии сделок SMB", subtitle: "2 дек · v2 · правит Ольга", status: ["черновик", "Нейтрально", "Темная"], open: "screen:protocol" },
          { title: "1:1 с Дмитрием Козловым", subtitle: "2 дек · разослан 2 из 2", status: ["доставлено", "Готово", "Яркая"], open: "screen:delivery-done" },
          { title: "Статус продаж, неделя 48", subtitle: "1 дек · разослан 6 из 6", status: ["доставлено", "Готово", "Яркая"], open: "screen:delivery-done" },
          { title: "Планёрка e-com, ноябрь", subtitle: "30 ноя · разослан 5 из 5", status: ["доставлено", "Готово", "Яркая"], open: "screen:delivery-done" },
          { title: "Комитет по бюджету, ноябрь", subtitle: "30 ноя · разослан 7 из 7", status: ["доставлено", "Готово", "Яркая"], open: "screen:delivery-done" },
        ],
      },
    ],
  },
};

/* ── Нагрузка: цвет фона Доски и прелоудера ──
   Сколько решений ждёт пользователя на всех этапах Доски: до 3 — зелёный, 4–6 — жёлтый, больше 6 — красный.
   Для показа можно задать в адресе: ?load=2 (число решений) или ?load=green|yellow|red. */
export type Load = "green" | "yellow" | "red";
export const decisionsWaiting = Object.values(boards).reduce((n, b) => n + b.urgent.length, 0);
export const loadOf = (n: number): Load => (n <= 3 ? "green" : n <= 6 ? "yellow" : "red");
export const load: Load = (() => {
  const q = new URLSearchParams(location.search).get("load");
  if (q === "green" || q === "yellow" || q === "red") return q;
  return loadOf(q !== null && q !== "" && !Number.isNaN(Number(q)) ? Number(q) : decisionsWaiting);
})();
/** Запустить фоновое видео; если система не дала автозапуск (iOS в энергосбережении) — запустить при первом касании */
export const playGlow = (v: HTMLVideoElement | null) => {
  if (!v) return;
  v.muted = true; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
  v.play?.().catch(() => {
    const retry = () => { v.play?.().catch(() => {}); };
    window.addEventListener("touchstart", retry, { once: true, passive: true });
    window.addEventListener("pointerdown", retry, { once: true });
  });
};
/** Видео анимированного градиента под текущую нагрузку */
// base — цвет фона компонента «Animation gradi …» в Figma: под видео, чтобы при запуске не мелькал чёрный
const GLOW_BASE: Record<Load, string> = { red: "#39000d", yellow: "#895e00", green: "#0f2e1e" };
export function glowFor(level: Load) {
  const path = `./assets/hero-glow-v3${level === "red" ? "" : `-${level}`}`;
  return { webm: `${path}.webm`, mp4: `${path}.mp4`, poster: `${path}-poster.jpg`, base: GLOW_BASE[level] };
}
export const glow = glowFor(load);

/* ── Таски: канбан по статусам ── */
/** project — проект из формы «Новая задача»; задача без проекта — поручение */
export type Task = { date: string; title: string; assignee: string; open?: string; project?: string };
export const columns: { title: string; glow: string; dot: string; tasks: Task[] }[] = [
  { title: "Просрочено", glow: "#b50028", dot: "var(--status-problem-fg)", tasks: [
    { date: "был 5 дек", title: "КП для «ТехноСтрой» на 40 лицензий", assignee: "Ольга Смирнова", open: "sheet:task1", project: "«ТехноСтрой»" },
    { date: "был 6 дек", title: "Отчёт по e-com за ноябрь", assignee: "Анна Волкова", open: "sheet:task2" },
  ] },
  { title: "В работе", glow: "#eee65a", dot: "var(--status-attention-fg)", tasks: [
    { date: "до 8 дек", title: "Сверить прогноз декабря с CRM", assignee: "Алексей Новиков", open: "sheet:task3" },
    { date: "до 10 дек", title: "Дорожная карта интеграции «Ромашка-Ритейл»", assignee: "Мария Лебедева", open: "sheet:task6", project: "«Ромашка-Ритейл»" },
    { date: "до 12 дек", title: "Креативы январской кампании", assignee: "Дмитрий Козлов", open: "sheet:task4" },
    { date: "до 15 дек", title: "Онбординг аккаунт-менеджера", assignee: "Екатерина Соколова", open: "sheet:task5", project: "Найм AM" },
  ] },
  { title: "Новые", glow: "#ff5379", dot: "var(--status-neutral-fg)", tasks: [
    { date: "до 11 дек", title: "Согласовать окно работ с клиентом", assignee: "Ольга Смирнова", open: "sheet:task9", project: "«Ромашка-Ритейл»" },
    { date: "до 21 дек", title: "План партнёрских мероприятий Q1", assignee: "Сергей Морозов", open: "sheet:task7" },
    { date: "до 22 дек", title: "Тезисы к совету директоров", assignee: "Алексей Новиков", open: "sheet:task8" },
  ] },
  { title: "Готово", glow: "#3deb8c", dot: "var(--status-done-fg)", tasks: [
    { date: "7 дек", title: "Запрос КП от «ТехноСтрой»", assignee: "Ольга Смирнова", open: "sheet:done1", project: "«ТехноСтрой»" },
    { date: "7 дек", title: "Перенос 1:1 на 14:00", assignee: "Ольга Смирнова", open: "sheet:del2" },
    { date: "4 дек", title: "Итог встречи по интеграции", assignee: "Мария Лебедева", open: "sheet:done2", project: "«Ромашка-Ритейл»" },
  ] },
];
export const plural = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "задача" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "задачи" : "задач"}`;

/* ── Статы ── */
export const stats = {
  title: "Неделя 1–7 декабря",
  heatmap: {
    title: "Загрузка по дням и часам", peak: "пик — среда", axis: ["9:00", "13:00", "17:00", "21:00"],
    // ступени палитры бренда: чем светлее, тем плотнее час
    days: [
      ["Пн", [800, 600, 400, 600, 800, 950, 600, 400, 200, 600, 800, 950, 800]],
      ["Вт", [950, 800, 600, 400, 400, 600, 800, 600, 400, 600, 800, 800, 950]],
      ["Ср", [600, 400, 200, 200, 400, 200, 400, 200, 200, 400, 600, 800, 800]],
      ["Чт", [800, 800, 600, 600, 800, 950, 800, 600, 600, 800, 800, 950, 950]],
      ["Пт", [950, 800, 800, 600, 800, 950, 800, 800, 600, 800, 950, 950, 950]],
      ["Сб", [950, 950, 950, 800, 800, 950, 950, 950, 950, 950, 950, 950, 950]],
      ["Вс", [950, 950, 950, 950, 950, 950, 950, 950, 800, 950, 950, 950, 950]],
    ] as [string, number[]][],
  },
  tiles: [
    { label: "Освобождено", value: "8 ч", caption: "цель 8–12 ч", icon: "clock", level: "Хорошо" },
    { label: "Писем", value: "312", caption: "41 решение в Telegram", icon: "mail", level: "Хорошо" },
    { label: "Протоколов", value: "9", caption: "4 мин до черновика", icon: "clipboard", level: "Хорошо" },
    { label: "В срок", value: "87%", caption: "2 просрочки: Ольга и Анна", icon: "check-circle", level: "Внимание" },
  ] as const,
  // «По дням»: столбцы по дням недели, переключатель метрик. Итоги совпадают с плитками сверху.
  byDay: {
    days: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    metrics: [
      { id: "time", label: "Время", vals: [95, 80, 125, 85, 70, 15, 10], minutes: true, total: "8 ч", totalSub: "освободил за неделю", notes: ["в будни в среднем 1 ч 31 мин", "цель 8–12 ч"] },
      { id: "letters", label: "Письма", vals: [58, 54, 70, 60, 50, 12, 8], total: "312", totalSub: "писем разобрал за неделю", notes: ["ответил на 186", "41 решение — в Telegram", "0 пропущенных срочных"] },
      { id: "meetings", label: "Встречи", vals: [1, 1, 3, 0, 1, 0, 0], total: "6", totalSub: "встреч провёл вместо вас", notes: ["4 ч 30 мин на встречах", "9 протоколов", "14 поручений выдано"] },
      { id: "protocols", label: "Протоколы", vals: [2, 2, 3, 1, 1, 0, 0], total: "9", totalSub: "протоколов собрал", notes: ["4 мин до черновика", "14 поручений из них"] },
      { id: "decisions", label: "Решения", vals: [8, 7, 10, 7, 6, 2, 1], total: "41", totalSub: "решение — одним касанием в Telegram", notes: ["пик — среда", "2 в выходные"] },
    ] as { id: string; label: string; vals: number[]; minutes?: boolean; total: string; totalSub: string; notes: string[] }[],
  },
};

/* ── Тосты ── */
/** Тосты. Все показываются с отменой (Toast Countdown) */
export const toasts: Record<string, { type: "Success" | "Error"; text: string }> = {
  t1: { type: "Success", text: "Напоминание отправлено Ольге от вашего имени" },
  t2: { type: "Success", text: "Ответ отправлен от вашего имени" },
  t3: { type: "Error", text: "Отклонено" },
  t4: { type: "Success", text: "Напоминание отправлено от вашего имени" },
  t5: { type: "Success", text: "Срок перенесён, исполнитель уведомлён" },
  t6: { type: "Success", text: "Vilar пойдёт на встречу вместо вас" },
  t7: { type: "Success", text: "Ссылка скопирована" },
  t8: { type: "Success", text: "Правка отозвана" },
  t10: { type: "Success", text: "Все уведомления прочитаны" },
  t11: { type: "Success", text: "Поручение отправлено Ольге от вашего имени" },
  t12: { type: "Error", text: "Вы пойдете на встречу сами" },
  t13: { type: "Success", text: "Задача создана" },
  t14: { type: "Success", text: "Встреча создана, приглашения уйдут участникам" },
  t15: { type: "Success", text: "Напомню в срок" },
  t16: { type: "Success", text: "Поручение отправлено от вашего имени" },
};

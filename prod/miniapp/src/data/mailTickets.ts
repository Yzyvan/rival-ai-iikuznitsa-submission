// Макетные письма Доски в формате договора (design/front-contract, тип mail).
// Тексты — те же, что были в макете: заголовки и теги строк, сводки и черновики шторок.
// «Сейчас» в макете — понедельник, 7 декабря 2026, 10:45.
import type { MailTicket } from "../api/front";

export const DEMO_NOW = new Date("2026-12-07T10:45:00+03:00");

const base = { type: "mail" as const, profile_id: "p01", version: 1, created_at: null, updated_at: null, thread_count: null, task_id: null, receipt: null };
const ask = { ...base, outcome: "ask" as const, needs_user: true, state: "waiting" as const, actions: ["send_reply", "edit_reply", "reject"] as MailTicket["actions"], delegated_to: null, done: null };
const handled = { ...base, needs_user: false, state: "done" as const, category: null, draft: null, reply_to: null, answer_by: null, amount: null };

export const demoMail: MailTicket[] = [
  { ...ask, id: "dec1", title: "Перенос 400 тыс. ₽ в digital", topic: "бюджет Q1", subject: "Перераспределение бюджета Q1",
    from: { id: "p10", name: "Наталья Павлова", role: "peer" }, received_at: "2026-12-06T16:39:00+03:00", source: { kind: "mail", id: "dec1", at: "2026-12-06T16:39:00+03:00" },
    quote: null, category: "money", reason: "деньги и бюджеты — только с подтверждением", amount: { value: 400000, currency: "RUB" }, answer_by: null, reply_to: { id: "p10", name: "Наталья Павлова" },
    summary: "Наталья просит до пятницы перенести 400 тыс. ₽ из партнёрских мероприятий в январский digital. Сергей Морозов против — вопрос на комитете в 16:30. Если согласуете, кампания стартует 12 января, а мероприятий в Q1 станет на одно меньше.",
    draft: "Наталья, решение дам сегодня после комитета в 16:30." },
  { ...ask, id: "dec2", title: "Оффер аккаунт-менеджеру", topic: "кадры", subject: "Кандидат на позицию аккаунт-менеджера",
    from: { id: "p11", name: "Игорь Фёдоров", role: "peer" }, received_at: "2026-12-06T15:24:00+03:00", source: { kind: "mail", id: "dec2", at: "2026-12-06T15:24:00+03:00" },
    quote: null, category: "hr", reason: "кадровые решения — только с подтверждением", amount: null, answer_by: null, reply_to: { id: "p11", name: "Игорь Фёдоров" },
    summary: "Игорь просит подтвердить оффер Кириллу Белову: 180 тыс. ₽, выход 15 декабря. Кандидат ждёт ответа до среды — потом уйдёт.",
    draft: "Игорь, подтверждаю оффер. Онбординг ведёт Екатерина." },
  { ...ask, id: "dec3", title: "Скидка 12% для «ТехноСтрой»", topic: "клиент", subject: "Скидка 12% для «ТехноСтрой»",
    from: { id: "p02", name: "Ольга Смирнова", role: "report" }, received_at: "2026-12-07T09:12:00+03:00", source: { kind: "mail", id: "dec3", at: "2026-12-07T09:12:00+03:00" },
    quote: null, category: "money", reason: "скидка — деньги и обязательство клиенту", amount: null, answer_by: "2026-12-07T18:00:00+03:00", reply_to: { id: "p02", name: "Ольга Смирнова" },
    summary: "«ТехноСтрой» подпишет 40 лицензий до конца года, если дадим 12% вместо 7%. Предлагаю 10% при оплате до 25 декабря, а 12% — только с годовым контрактом. Маржа по сделке будет ниже на 3 п.п.",
    draft: "Ольга, согласен на 10% при оплате до 25 декабря. 12% — только с годовым контрактом." },
  // внешнее выступление решает руководитель: Vilar не делегирует и не отказывается сам
  { ...ask, id: "del3", title: "Приглашение на «Digital Sales»", topic: "выступление", subject: "Приглашение спикером на конференцию",
    from: { id: null, name: "Организаторы конференции", role: "external" }, received_at: "2026-12-07T09:11:00+03:00", source: { kind: "mail", id: "del3", at: "2026-12-07T09:11:00+03:00" },
    quote: "Приглашаем выступить 18 февраля, тема — ИИ в продажах.", category: "other", reason: "внешнее выступление — решает руководитель", amount: null, answer_by: null,
    reply_to: { id: null, name: "Организаторы конференции" },
    summary: "Организаторы зовут выступить 18 февраля, тема — ИИ в продажах. Участвовать или нет — решаете вы. Если да, попрошу Екатерину уточнить формат и программу.",
    draft: "Спасибо за приглашение! Тема интересная. Подтвержу участие до конца недели." },

  { ...handled, id: "del1", outcome: "delegated", actions: ["remind"], title: "Запрос КП от «ТехноСтрой»", topic: "продажи", subject: "Запрос коммерческого предложения",
    from: { id: null, name: "Клиент «ТехноСтрой»", role: "client" }, received_at: "2026-12-07T08:47:00+03:00", source: { kind: "mail", id: "del1", at: "2026-12-07T08:47:00+03:00" },
    quote: null, reason: "КП → директор по продажам", delegated_to: { id: "p02", name: "Ольга Смирнова" }, done: "передал Ольге",
    summary: "Передал запрос на 40 лицензий Ольге, срок был 5 декабря. Срок прошёл — клиент написал повторно сегодня в 09:32." },
  { ...handled, id: "del2", outcome: "auto", actions: [], title: "Перенос 1:1 на 14:00", topic: "календарь", subject: "Перенос 1:1",
    from: { id: "p02", name: "Ольга Смирнова", role: "report" }, received_at: "2026-12-07T08:20:00+03:00", source: { kind: "mail", id: "del2", at: "2026-12-07T08:20:00+03:00" },
    quote: null, reason: "перенос внутренней встречи — можно без подтверждения", delegated_to: null, done: "согласовал с Ольгой",
    summary: "Ольга просила 1:1 в 12:00 — вышло бы три встречи подряд. Поставил на 14:00, до и после остаётся по 15 минут. Ольга подтвердила." },
  { ...handled, id: "del4", outcome: "digest", actions: [], title: "Прогноз декабря — 94% плана", topic: "продажи", subject: "Прогноз декабря",
    from: { id: "p02", name: "Ольга Смирнова", role: "report" }, received_at: "2026-12-07T10:16:00+03:00", source: { kind: "mail", id: "del4", at: "2026-12-07T10:16:00+03:00" },
    quote: null, reason: "отчёты и статусы — в сводку", delegated_to: null, done: null,
    summary: "Добавил прогноз в утреннюю сводку и попросил Алексея сверить его с CRM. Сверка будет завтра." },
];

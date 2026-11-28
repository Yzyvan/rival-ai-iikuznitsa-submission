// Глубокие ссылки: кнопка ↗ в сообщении бота открывает мини-апп сразу на нужном экране и шторке — без прелоудера.
// Нижняя кнопка «Меню» открывает мини-апп без параметров — тогда, как и раньше, показывается прелоудер.
//
// Два способа передать цель:
//   1. Кнопка web_app в сообщении: https://…/vilar/?open=sheet:dec1   (несколько целей — через запятую)
//   2. Прямая ссылка t.me/<бот>/<приложение>?startapp=sheet-dec1      (Telegram пускает только A–Z a–z 0–9 _ -,
//      поэтому «:» → «-», а цели разделяются «__»: board-mail__sheet-dec1)
//
// Цели: tab:board|tasks|stats · board:mail|approvals|meetings · screen:<вложенный экран> · sheet:<шторка>
// Если указана только шторка, под ней сам открывается тот раздел, откуда эта шторка открывается в приложении.
import { boards, columns, type StageId } from "./data/content";
import { sheets } from "./data/sheets";
import type { TabId } from "./ui";

export type DeepLink = { skip: boolean; tab?: TabId; stage?: StageId; screens: string[]; sheet?: string; mailTicket?: string };

const TABS: TabId[] = ["board", "tasks", "stats"];

function rawTargets(): { targets: string[]; skip: boolean } {
  const q = new URLSearchParams(location.search);
  const targets: string[] = [];
  const open = q.get("open");
  if (open) targets.push(...open.split(",").map((s) => s.trim()).filter(Boolean));
  const start = q.get("tgWebAppStartParam") ?? (window as any).Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (typeof start === "string" && start) {
    for (const part of start.split("__")) {
      const cut = part.indexOf("-");
      if (cut > 0) targets.push(part.slice(0, cut) + ":" + part.slice(cut + 1));
    }
  }
  const screen = q.get("screen");   // старый параметр ?screen=protocol
  if (screen) targets.push("screen:" + screen);
  return { targets, skip: q.has("skip") };
}

/** Где в приложении лежит строка, открывающая эту шторку: этап Доски или колонка Тасков */
function homeOf(sheet: string): { tab: TabId; stage?: StageId } | undefined {
  const needle = `"sheet:${sheet}"`;
  for (const [stage, board] of Object.entries(boards)) if (JSON.stringify(board).includes(needle)) return { tab: "board", stage: stage as StageId };
  if (JSON.stringify(columns).includes(needle)) return { tab: "tasks" };
  return undefined;
}

export function readDeepLink(nested: Record<string, unknown>, live = false, showTracker = false): DeepLink {
  const { targets, skip } = rawTargets();
  const link: DeepLink = { skip, screens: [] };
  for (const t of targets) {
    const cut = t.indexOf(":"), kind = t.slice(0, cut), id = t.slice(cut + 1);
    if (kind === "tab" && TABS.includes(id as TabId)) link.tab = id as TabId;
    else if (kind === "board" && id in boards) { link.tab = "board"; link.stage = id as StageId; }
    else if (live && kind === "mail" && /^[de]-[A-Za-z0-9_-]{1,150}$/.test(id)) {
      link.tab = "board"; link.stage = "mail"; link.mailTicket = id;
    }
    else if (live && kind === "screen" && ["protocol", "delivery", "delivery-done"].includes(id)) {
      link.tab = "board"; link.stage = "meetings";
    }
    else if (live && kind === "screen" && id === "task") link.tab = "tasks";
    else if (kind === "screen" && id in nested) link.screens.push(id);
    else if (kind === "sheet" && (id in sheets || id === "newtask" || id === "filter")) link.sheet = id;
  }
  // ?stage=mail — этап, на котором человек был до перезагрузки. Это не ссылка: прелоудер показывается как обычно.
  const remembered = new URLSearchParams(location.search).get("stage");
  if (!link.stage && remembered && remembered in boards) link.stage = remembered as StageId;
  if (link.sheet === "filter" && !link.tab) link.tab = "tasks";   // фильтр живёт в Тасках
  if (link.sheet && !link.tab && !link.screens.length) Object.assign(link, homeOf(link.sheet));
  if (live && link.sheet) {
    // Older bot cards identify a demo sheet rather than a backend record. Open its live list.
    if (/^task\d+$/.test(link.sheet) || link.sheet === "newtask") link.tab = "tasks";
    const taskSheet = link.sheet === "filter" || link.sheet === "newtask";
    if (showTracker || link.tab !== "tasks" || !taskSheet) delete link.sheet;
  }
  // открыли по ссылке на конкретное место — сразу туда, без прелоудера
  if (link.tab || link.screens.length || link.sheet) link.skip = true;
  return link;
}

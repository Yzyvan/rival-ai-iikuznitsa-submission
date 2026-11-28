// «Открой вот эту карточку»: уведомление ведёт не просто в раздел, а сразу в шторку нужной карточки.
// Экран-получатель может быть ещё не открыт или данные ещё не пришли — тогда просьба ждёт, пока её смогут выполнить.
import { useEffect } from "react";

type Focus = { kind: "mail" | "meeting" | "approval" | "task"; id: string };
let pending: Focus | null = null;
const subs = new Set<() => void>();

export const focusOn = (f: Focus) => { pending = f; subs.forEach((run) => run()); };

/** open возвращает true, если карточка нашлась и открыта. deps — данные, после прихода которых стоит попробовать снова. */
export function useFocus(kind: Focus["kind"], open: (id: string) => boolean, deps: unknown[]) {
  useEffect(() => {
    const run = () => { if (pending?.kind === kind && open(pending.id)) pending = null; };
    run();
    subs.add(run);
    return () => { subs.delete(run); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

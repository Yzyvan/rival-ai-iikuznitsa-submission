// Навигация без роутера: экран из нижнего меню, поверх него — вложенный экран, шторка и тост.
import { createContext, useContext } from "react";

/** "pick:t5" — сначала выбрать новую дату и время, потом тост · "sheet:dec1" · "toast:t2" · "screen:protocol" (открыть поверх) · "replace:delivery-done" · "back" · "home" · "board:meetings" · "close" */
export type Target = string;
export const NavContext = createContext<(target: Target) => void>(() => {});
export const useNav = () => useContext(NavContext);

// Действие, которое выполняется, только если тост с отменой досчитал до конца (крестик — отмена)
let pending: (() => void) | null = null;
export const onToastCommit = (fn: () => void) => { pending = fn; };
export const takePending = () => { const fn = pending; pending = null; return fn; };

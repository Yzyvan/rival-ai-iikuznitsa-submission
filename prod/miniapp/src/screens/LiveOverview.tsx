import { useState } from "react";
import { createPortal } from "react-dom";
import { useTaskRead } from "../../../../integrations/tracker/transport/bindings";
import { ListRow, Section } from "../ui";
import { SheetView } from "./SheetView";

type Approval = {
  step_id: string;
  title: string;
  assignee_name: string;
  reviewer_name: string;
  result_version: number;
};

export function useApprovals(active: boolean) {
  return useTaskRead<{ rows: Approval[] }>(active ? "board" : null);
}

export function LiveApprovals({ data, error }: ReturnType<typeof useApprovals>) {
  const [selectedId, select] = useState<string | null>(null);
  const selected = data?.rows.find(row => row.step_id === selectedId);

  return <Section title="Результаты на согласовании">
    {(error || !data?.rows.length) && <p role="status">
      {error || (data ? "Результатов на согласовании пока нет." : "Загрузка…")}
    </p>}
    {data?.rows.map(row => (
      <ListRow key={row.step_id} title={row.title} subtitle={row.assignee_name}
        onClick={() => select(row.step_id)} />
    ))}
    {selected && createPortal(
      <SheetView key={selected.step_id} sheet={{
        title: selected.title,
        tags: [selected.assignee_name, "На согласовании"],
        msg: `Проверяющий: ${selected.reviewer_name}. Версия результата: ${selected.result_version}.`,
        actions: [["Закрыть", "ghost", "close"]],
      }} onAction={() => select(null)} />,
      document.querySelector(".app")!,
    )}
  </Section>;
}

export function buzz(power: "light" | "medium") {
  navigator.vibrate?.(power === "medium" ? 25 : 12);
}
export function tick() {
  navigator.vibrate?.(12);
}

export function Button({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn btn--secondary btn--s btn--fill" type="button" onClick={onClick}>
      {label}
      <span aria-hidden="true">＋</span>
    </button>
  );
}
export function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn btn--ghost btn--s" type="button" onClick={onClick}>
      {label}
    </button>
  );
}
export function TaskCard({
  date,
  title,
  assignee,
  onClick,
}: {
  date: string;
  title: string;
  assignee: string;
  onClick?: () => void;
}) {
  const initials = assignee
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (
    <button type="button" className="task-card" onClick={onClick}>
      <span className="t-caption c-secondary">{date}</span>
      <span className="t-body-l">{title}</span>
      <span className="row" style={{ gap: 8 }}>
        <span className="task-initials" aria-hidden="true">
          {initials}
        </span>
        <span className="t-body-m c-secondary">{assignee}</span>
      </span>
    </button>
  );
}

import type { User } from "@/lib/types";

const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2"];

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({ user, size = 24 }: { user: User | null; size?: number }) {
  if (!user) {
    return (
      <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned" aria-label="Unassigned">
        ?
      </span>
    );
  }
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: colorFor(user.accountId), fontSize: size * 0.42 }}
      title={user.displayName}
      aria-label={user.displayName}
    >
      {initials}
    </span>
  );
}

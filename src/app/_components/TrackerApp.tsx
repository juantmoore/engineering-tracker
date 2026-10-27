"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useOptimistic, useState, useTransition } from "react";
import type { Issue, StatusName, User } from "@/lib/types";
import { addCommentAction, assignIssueAction, moveIssueAction, resetBoardAction, type ActionResult } from "../actions";
import { Board } from "./Board";
import { IssueDrawer } from "./IssueDrawer";

type Patch = { key: string; status?: StatusName; assignee?: User | null };

interface Props {
  issues: Issue[];
  users: User[];
  storeKind: "redis" | "memory";
}

const REFRESH_MS = 4_000;

export function TrackerApp({ issues, users, storeKind }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, applyPatch] = useOptimistic(issues, (state: Issue[], patch: Patch) =>
    state.map((i) => (i.key === patch.key ? { ...i, ...patch } : i)),
  );

  // Picks up changes made elsewhere: the agent's API calls, cron runs, other tabs.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !isPending) router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [router, isPending]);

  const mutate = useCallback(
    (patch: Patch | null, action: () => Promise<ActionResult>) => {
      setError(null);
      startTransition(async () => {
        if (patch) applyPatch(patch);
        const result = await action();
        if (result.error) setError(result.error);
      });
    },
    [applyPatch],
  );

  const move = (key: string, status: StatusName) => {
    if (view.find((i) => i.key === key)?.status === status) return;
    mutate({ key, status }, () => moveIssueAction(key, status));
  };
  const assign = (key: string, accountId: string | null) =>
    mutate({ key, assignee: users.find((u) => u.accountId === accountId) ?? null }, () => assignIssueAction(key, accountId));
  const comment = async (key: string, body: string) => {
    setError(null);
    const result = await addCommentAction(key, body);
    if (result.error) setError(result.error);
    return !result.error;
  };
  const reset = () => {
    if (!window.confirm("Reset every ticket to the seeded demo data and clear the delivery log?")) return;
    setSelectedKey(null);
    mutate(null, resetBoardAction);
  };

  const selected = view.find((i) => i.key === selectedKey) ?? null;
  const closeDrawer = useCallback(() => setSelectedKey(null), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">W</span>
          <div>
            <h1>Engineering Tracker</h1>
            <p className="muted">WorkIt engineering board (WIT)</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`badge badge-${storeKind}`} title="Where tickets are stored">
            {storeKind === "redis" ? "Upstash Redis" : "In-memory store"}
          </span>
          <button type="button" className="button" onClick={reset} disabled={isPending}>
            Reset to seed
          </button>
        </div>
      </header>

      {error && (
        <div className="alert" role="alert">
          {error}
          <button type="button" className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <main className="content">
        <Board issues={view} onMove={move} onOpen={setSelectedKey} />
      </main>

      {selected && (
        <IssueDrawer
          issue={selected}
          users={users}
          onClose={closeDrawer}
          onMove={(status) => move(selected.key, status)}
          onAssign={(accountId) => assign(selected.key, accountId)}
          onComment={(body) => comment(selected.key, body)}
        />
      )}
    </div>
  );
}

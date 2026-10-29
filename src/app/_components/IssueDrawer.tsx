"use client";

import { useEffect, useState } from "react";
import { STATUSES, type Issue, type StatusName, type User } from "@/lib/types";
import { Avatar } from "./Avatar";
import { RelativeTime } from "./RelativeTime";

interface Props {
  issue: Issue;
  users: User[];
  onClose: () => void;
  onMove: (status: StatusName) => void;
  onAssign: (accountId: string | null) => void;
  onComment: (body: string) => Promise<boolean>;
}

export function IssueDrawer({ issue, users, onClose, onMove, onAssign, onComment }: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    if (await onComment(draft)) setDraft("");
    setSending(false);
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        data-testid="issue-drawer"
        data-key={issue.key}
        role="dialog"
        aria-label={`${issue.key} details`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-header">
          <span className="card-key">{issue.key}</span>
          <button type="button" className="icon-button" data-testid="close-drawer" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <h2 className="drawer-title">{issue.summary}</h2>

        <div className="drawer-fields">
          <label>
            <span>Status</span>
            <select name="status" value={issue.status} onChange={(e) => onMove(e.target.value as StatusName)}>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Assignee</span>
            <div className="assignee-field">
              <Avatar user={issue.assignee} />
              <select
                name="assignee"
                value={issue.assignee?.accountId ?? ""}
                onChange={(e) => onAssign(e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.accountId} value={u.accountId}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <p className="drawer-updated">
            Updated <RelativeTime iso={issue.updated} />
          </p>
        </div>

        <section className="comments">
          <h3>Comments ({issue.comments.length})</h3>
          {issue.comments.length === 0 && <p className="muted">No comments yet.</p>}
          <ol>
            {issue.comments.map((c) => (
              <li key={c.id} className="comment" data-testid="comment">
                <div className="comment-head">
                  <strong>{c.author}</strong>
                  <RelativeTime iso={c.created} />
                </div>
                <p>{c.body}</p>
              </li>
            ))}
          </ol>
          <form onSubmit={submit} className="comment-form">
            <textarea
              data-testid="comment-input"
              placeholder="Add a comment"
              value={draft}
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
              }}
            />
            <button type="submit" className="button button-primary" data-testid="comment-submit" disabled={!draft.trim() || sending}>
              {sending ? "Saving..." : "Comment"}
            </button>
          </form>
        </section>
      </aside>
    </div>
  );
}

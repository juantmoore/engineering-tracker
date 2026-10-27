"use client";

import { useState } from "react";
import { STATUSES, type Issue, type StatusName } from "@/lib/types";
import { Avatar } from "./Avatar";

interface Props {
  issues: Issue[];
  onMove: (key: string, status: StatusName) => void;
  onOpen: (key: string) => void;
}

export function Board({ issues, onMove, onOpen }: Props) {
  const [dragOver, setDragOver] = useState<StatusName | null>(null);

  return (
    <div className="board" data-testid="board">
      {STATUSES.map(({ id, name }) => {
        const cards = issues.filter((i) => i.status === name);
        return (
          <section
            key={id}
            className={`column column-${id}${dragOver === name ? " column-over" : ""}`}
            data-column={name}
            aria-label={name}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOver(name);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const key = e.dataTransfer.getData("text/plain");
              if (key) onMove(key, name);
            }}
          >
            <header className="column-header">
              <span className={`status-dot status-${id}`} />
              <h2>{name}</h2>
              <span className="column-count">{cards.length}</span>
            </header>
            <div className="column-cards">
              {cards.map((issue) => (
                <button
                  key={issue.key}
                  type="button"
                  className="card"
                  draggable
                  data-issue-key={issue.key}
                  data-assignee={issue.assignee?.accountId ?? ""}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", issue.key);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onOpen(issue.key)}
                >
                  <span className="card-summary">{issue.summary}</span>
                  <span className="card-meta">
                    <span className="card-key">{issue.key}</span>
                    {issue.comments.length > 0 && (
                      <span className="card-comments" title={`${issue.comments.length} comments`}>
                        {issue.comments.length} {issue.comments.length === 1 ? "comment" : "comments"}
                      </span>
                    )}
                    <Avatar user={issue.assignee} />
                  </span>
                </button>
              ))}
              {cards.length === 0 && <p className="column-empty">Drop tickets here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

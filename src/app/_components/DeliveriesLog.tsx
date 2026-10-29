"use client";

import type { Delivery } from "@/lib/types";
import { RelativeTime } from "./RelativeTime";

interface Props {
  deliveries: Delivery[];
  webhook: { targetHost: string | null; secretSet: boolean };
}

function result(d: Delivery) {
  if (d.skipped) return { label: "Skipped", tone: "muted" };
  if (d.ok) return { label: String(d.statusCode), tone: "ok" };
  return { label: d.statusCode ? String(d.statusCode) : "Error", tone: "bad" };
}

export function DeliveriesLog({ deliveries, webhook }: Props) {
  return (
    <section className="panel" data-testid="deliveries" aria-label="Recent webhook deliveries">
      <header className="panel-header">
        <div>
          <h2>Recent webhook deliveries</h2>
          <p className="muted">
            {webhook.targetHost ? (
              <>
                POST to <code>{webhook.targetHost}</code> on every status or assignee change.
                {!webhook.secretSet && " TRACKER_WEBHOOK_SECRET is not set, so nothing is sent."}
              </>
            ) : (
              "AGENT_WEBHOOK_URL is not set, so changes are logged here but not sent."
            )}
          </p>
        </div>
        <span className="muted">Last {deliveries.length}</span>
      </header>
      {deliveries.length === 0 ? (
        <p className="panel-empty muted">No deliveries yet. Move a ticket to fire one.</p>
      ) : (
        <div className="table-wrap">
          <table className="deliveries">
            <thead>
              <tr>
                <th>When</th>
                <th>Ticket</th>
                <th>Change</th>
                <th>Event ID</th>
                <th>Attempt</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => {
                const r = result(d);
                return (
                  <tr
                    key={d.id}
                    data-testid="delivery"
                    data-event-id={d.eventId}
                    data-status-code={d.statusCode ?? ""}
                    title={d.error ?? undefined}
                  >
                    <td>
                      <RelativeTime iso={d.at} />
                    </td>
                    <td className="mono">{d.issueKey}</td>
                    <td>{d.change}</td>
                    <td className="mono event-id">{d.eventId}</td>
                    <td>{d.skipped ? "-" : `${d.attempt} of ${d.maxAttempts}`}</td>
                    <td>
                      <span className={`pill pill-${r.tone}`}>{r.label}</span>
                      {d.error && !d.ok && <span className="delivery-error">{d.error}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

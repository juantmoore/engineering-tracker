import type { Delivery, Issue, Settings } from "../types";

export const DELIVERY_LOG_LIMIT = 50;

export const DEFAULT_SETTINGS: Settings = { autoMode: false };

export interface TrackerStore {
  readonly kind: "redis" | "memory";
  listIssues(): Promise<Issue[]>;
  getIssue(key: string): Promise<Issue | null>;
  putIssue(issue: Issue): Promise<void>;
  listDeliveries(limit?: number): Promise<Delivery[]>;
  addDelivery(delivery: Delivery): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  /** Restores the seeded tickets, clears the delivery log and turns auto mode off. */
  reset(): Promise<void>;
}

export function sortIssues(issues: Issue[]): Issue[] {
  const num = (k: string) => Number(k.split("-")[1]);
  return [...issues].sort((a, b) => num(a.key) - num(b.key));
}

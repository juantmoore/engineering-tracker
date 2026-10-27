import { seedIssues } from "../seed";
import type { Delivery, Issue, Settings } from "../types";
import { DEFAULT_SETTINGS, DELIVERY_LOG_LIMIT, sortIssues, type TrackerStore } from "./shared";

/** Process-local store for local dev and tests. Not shared across serverless instances. */
export class MemoryStore implements TrackerStore {
  readonly kind = "memory" as const;
  private issues = new Map<string, Issue>();
  private deliveries: Delivery[] = [];
  private settings: Settings = { ...DEFAULT_SETTINGS };

  constructor() {
    this.seed();
  }

  private seed() {
    this.issues = new Map(seedIssues().map((i) => [i.key, i]));
  }

  async listIssues() {
    return sortIssues([...this.issues.values()].map((i) => structuredClone(i)));
  }

  async getIssue(key: string) {
    const issue = this.issues.get(key);
    return issue ? structuredClone(issue) : null;
  }

  async putIssue(issue: Issue) {
    this.issues.set(issue.key, structuredClone(issue));
  }

  async listDeliveries(limit = DELIVERY_LOG_LIMIT) {
    return this.deliveries.slice(0, limit).map((d) => ({ ...d }));
  }

  async addDelivery(delivery: Delivery) {
    this.deliveries.unshift({ ...delivery });
    this.deliveries.length = Math.min(this.deliveries.length, DELIVERY_LOG_LIMIT);
  }

  async getSettings() {
    return { ...this.settings };
  }

  async setSettings(settings: Settings) {
    this.settings = { ...settings };
  }

  async reset() {
    this.seed();
    this.deliveries = [];
    this.settings = { ...DEFAULT_SETTINGS };
  }
}

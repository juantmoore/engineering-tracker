import { Redis } from "@upstash/redis";
import { seedIssues } from "../seed";
import type { Delivery, Issue, Settings } from "../types";
import { DEFAULT_SETTINGS, DELIVERY_LOG_LIMIT, sortIssues, type TrackerStore } from "./shared";

const PREFIX = "tracker:v1";
const ISSUES = `${PREFIX}:issues`;
const DELIVERIES = `${PREFIX}:deliveries`;
const SETTINGS = `${PREFIX}:settings`;

export class RedisStore implements TrackerStore {
  readonly kind = "redis" as const;
  private redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token, automaticDeserialization: false });
  }

  private async writeSeed() {
    const entries = Object.fromEntries(seedIssues().map((i) => [i.key, JSON.stringify(i)]));
    await this.redis.hset(ISSUES, entries);
  }

  private async ensureSeeded() {
    if (!(await this.redis.exists(ISSUES))) await this.writeSeed();
  }

  async listIssues() {
    await this.ensureSeeded();
    const all = (await this.redis.hgetall<Record<string, string>>(ISSUES)) ?? {};
    return sortIssues(Object.values(all).map((v) => JSON.parse(v) as Issue));
  }

  async getIssue(key: string) {
    await this.ensureSeeded();
    const raw = await this.redis.hget<string>(ISSUES, key);
    return raw ? (JSON.parse(raw) as Issue) : null;
  }

  async putIssue(issue: Issue) {
    await this.redis.hset(ISSUES, { [issue.key]: JSON.stringify(issue) });
  }

  async listDeliveries(limit = DELIVERY_LOG_LIMIT) {
    const raw = await this.redis.lrange<string>(DELIVERIES, 0, limit - 1);
    return raw.map((v) => JSON.parse(v) as Delivery);
  }

  async addDelivery(delivery: Delivery) {
    await this.redis
      .pipeline()
      .lpush(DELIVERIES, JSON.stringify(delivery))
      .ltrim(DELIVERIES, 0, DELIVERY_LOG_LIMIT - 1)
      .exec();
  }

  async getSettings(): Promise<Settings> {
    const raw = await this.redis.get<string>(SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Settings) } : { ...DEFAULT_SETTINGS };
  }

  async setSettings(settings: Settings) {
    await this.redis.set(SETTINGS, JSON.stringify(settings));
  }

  async reset() {
    await this.redis.del(ISSUES, DELIVERIES, SETTINGS);
    await this.writeSeed();
  }
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("ships the shared contract as docs/contract.md", () => {
    const contract = readFileSync(new URL("../docs/contract.md", import.meta.url), "utf8");
    expect(contract).toContain("Engineering Tracker <-> eve agent contract (v1)");
    expect(contract).toContain("POST {AGENT_BASE_URL}/jira/events");
  });
});

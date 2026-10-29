import { beforeEach, describe, expect, it } from "vitest";
import { getStore } from "@/lib/store";
import { addComment, assignIssue, TrackerError, transitionIssue } from "@/lib/tracker";
import { UI_ACTOR } from "@/lib/users";

async function expectTrackerError(p: Promise<unknown>, status: number) {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(TrackerError);
  expect((err as TrackerError).status).toBe(status);
}

beforeEach(async () => {
  await getStore().reset();
});

describe("transitionIssue", () => {
  it("moves the ticket, bumps updated and persists", async () => {
    const before = (await getStore().getIssue("WIT-11"))!;
    const { issue, changed } = await transitionIssue("WIT-11", "In Progress", UI_ACTOR);
    expect(changed).toBe(true);
    expect(issue.status).toBe("In Progress");
    expect(Date.parse(issue.updated)).toBeGreaterThan(Date.parse(before.updated));
    expect((await getStore().getIssue("WIT-11"))!.status).toBe("In Progress");
  });

  it("accepts status names case-insensitively, status ids and lowercase keys", async () => {
    expect((await transitionIssue("wit-11", "in review", UI_ACTOR)).issue.status).toBe("In Review");
    expect((await transitionIssue("WIT-11", "blocked", UI_ACTOR)).issue.status).toBe("Blocked");
    expect((await transitionIssue("WIT-11", "to_do", UI_ACTOR)).issue.status).toBe("To Do");
  });

  it("reports no change when the status is already set", async () => {
    const { changed } = await transitionIssue("WIT-11", "To Do", UI_ACTOR);
    expect(changed).toBe(false);
  });

  it("rejects unknown statuses with 400 and unknown keys with 404", async () => {
    await expectTrackerError(transitionIssue("WIT-11", "Shipped", UI_ACTOR), 400);
    await expectTrackerError(transitionIssue("WIT-11", undefined, UI_ACTOR), 400);
    await expectTrackerError(transitionIssue("WIT-404", "Done", UI_ACTOR), 404);
  });
});

describe("assignIssue", () => {
  it("assigns a known user and unassigns with null", async () => {
    const { issue } = await assignIssue("WIT-11", "u-mei", UI_ACTOR);
    expect(issue.assignee).toEqual({ accountId: "u-mei", displayName: "Mei Chen" });
    const { issue: cleared, changed } = await assignIssue("WIT-11", null, UI_ACTOR);
    expect(changed).toBe(true);
    expect(cleared.assignee).toBeNull();
    expect((await getStore().getIssue("WIT-11"))!.assignee).toBeNull();
  });

  it("rejects unknown users and a missing accountId with 400", async () => {
    await expectTrackerError(assignIssue("WIT-11", "u-nobody", UI_ACTOR), 400);
    await expectTrackerError(assignIssue("WIT-11", undefined, UI_ACTOR), 400);
    await expectTrackerError(assignIssue("WIT-404", "u-sam", UI_ACTOR), 404);
  });
});

describe("addComment", () => {
  it("appends a comment with id, author and created timestamp", async () => {
    const comment = await addComment("WIT-11", "Looking into this now.", "workit-agent");
    expect(comment).toMatchObject({ body: "Looking into this now.", author: "workit-agent" });
    expect(comment.id).toBeTruthy();
    expect(Number.isNaN(Date.parse(comment.created))).toBe(false);
    const stored = (await getStore().getIssue("WIT-11"))!;
    expect(stored.comments.at(-1)).toEqual(comment);
  });

  it("defaults the author and rejects empty bodies", async () => {
    expect((await addComment("WIT-11", "hi", undefined)).author).toBe("workit-agent");
    await expectTrackerError(addComment("WIT-11", "   ", "x"), 400);
    await expectTrackerError(addComment("WIT-11", 42, "x"), 400);
    await expectTrackerError(addComment("WIT-404", "hi", "x"), 404);
  });
});

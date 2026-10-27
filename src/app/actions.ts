"use server";

import { revalidatePath } from "next/cache";
import { getStore } from "@/lib/store";
import { addComment, assignIssue, TrackerError, transitionIssue } from "@/lib/tracker";
import { UI_ACTOR } from "@/lib/users";

export interface ActionResult {
  error?: string;
}

async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    return {};
  } catch (e) {
    if (e instanceof TrackerError) return { error: e.message };
    console.error(e);
    return { error: "Something went wrong. Try again." };
  } finally {
    revalidatePath("/");
  }
}

export async function moveIssueAction(key: string, status: string) {
  return run(() => transitionIssue(key, status, UI_ACTOR));
}

export async function assignIssueAction(key: string, accountId: string | null) {
  return run(() => assignIssue(key, accountId, UI_ACTOR));
}

export async function addCommentAction(key: string, body: string) {
  return run(() => addComment(key, body, UI_ACTOR.displayName));
}

export async function resetBoardAction() {
  return run(() => getStore().reset());
}

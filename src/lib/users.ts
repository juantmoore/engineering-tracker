import type { User } from "./types";

export const USERS: User[] = [
  { accountId: "u-patrick", displayName: "Patrick Hughes" },
  { accountId: "u-sam", displayName: "Sam Lee" },
  { accountId: "u-priya", displayName: "Priya Raman" },
  { accountId: "u-diego", displayName: "Diego Alvarez" },
  { accountId: "u-mei", displayName: "Mei Chen" },
];

/** The person clicking around the board in the demo. */
export const UI_ACTOR: User = USERS[0];

/** Changes made through the write-back API are attributed to the agent, like Jira does. */
export const AGENT_ACTOR: User = { accountId: "workit-agent", displayName: "WorkIt Agent" };

export const AUTO_ACTOR: User = { accountId: "u-automation", displayName: "Auto mode" };

export function findUser(accountId: string): User | undefined {
  return USERS.find((u) => u.accountId === accountId);
}

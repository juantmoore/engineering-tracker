import { getStore } from "@/lib/store";
import { USERS } from "@/lib/users";
import { TrackerApp } from "./_components/TrackerApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const store = getStore();
  const issues = await store.listIssues();
  return <TrackerApp issues={issues} users={USERS} storeKind={store.kind} />;
}

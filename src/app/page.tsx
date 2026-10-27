import { webhookSecret, webhookTarget } from "@/lib/config";
import { getStore } from "@/lib/store";
import { USERS } from "@/lib/users";
import { TrackerApp } from "./_components/TrackerApp";

export const dynamic = "force-dynamic";

function hostOf(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

export default async function Home() {
  const store = getStore();
  const [issues, deliveries] = await Promise.all([store.listIssues(), store.listDeliveries(20)]);
  return (
    <TrackerApp
      issues={issues}
      users={USERS}
      storeKind={store.kind}
      deliveries={deliveries}
      webhook={{ targetHost: hostOf(webhookTarget()), secretSet: Boolean(webhookSecret()) }}
    />
  );
}

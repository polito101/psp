import { HomeDashboard } from "@/components/home/home-dashboard";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

export default async function HomePage() {
  const session = await readLayoutSessionFromCookies();
  return <HomeDashboard session={session} />;
}

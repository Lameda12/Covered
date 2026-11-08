import { HelpFlow } from "@/components/HelpFlow";
import { currentUser } from "@/lib/supabase/server";

export const metadata = { title: "Get a bill covered · Covered" };
export const dynamic = "force-dynamic";

export default async function Help() {
  const user = await currentUser();
  return (
    <>
      <h1>Need a bill covered?</h1>
      <p className="sub">Snap the bill. We confirm it, you stay anonymous, and givers pay the biller directly. No sob story required.</p>
      <HelpFlow email={user?.email ?? null} />
    </>
  );
}

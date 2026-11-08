import { BackToDeck, ThanksClient } from "@/components/ThanksClient";

export const metadata = { title: "Thank you · Covered", robots: { index: false } };

export default async function Thanks({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  return (
    <>
      <h1>Thank you.</h1>
      <p className="sub">Your receipt is on its way to your inbox, with a link to your giving history.</p>
      {session_id ? <div style={{ marginTop: 14 }}><ThanksClient sessionId={session_id} /></div> : null}
      <BackToDeck />
    </>
  );
}

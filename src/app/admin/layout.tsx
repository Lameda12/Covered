import Link from "next/link";

export const metadata = { title: "Admin · Covered", robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="chips">
        <Link className="chip" href="/admin/review">Review</Link>
        <Link className="chip" href="/admin/payouts">Payouts</Link>
      </div>
      {children}
    </>
  );
}

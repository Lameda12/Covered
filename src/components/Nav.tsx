"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [["/", "Give"], ["/sweep", "Sweep"], ["/help", "Get help"], ["/receipts", "Receipts"]] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={(href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}

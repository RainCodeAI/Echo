"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AudioLines,
  Hammer,
  LayoutDashboard,
  Settings,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/notes", label: "Notes", icon: AudioLines },
  { href: "/dashboard/jobs", label: "Jobs", icon: Hammer },
  { href: "/dashboard/team", label: "Crew", icon: UsersRound },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

/** Bottom tab bar for owner dashboard on small screens. */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="flex border-t bg-card md:hidden">
      {ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact
          ? pathname === href
          : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

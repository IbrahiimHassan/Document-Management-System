"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, FolderOpen, LogOut, UploadCloud } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "./Button";

const links = [
  { href: "/", label: "Documents", icon: FolderOpen },
  { href: "/upload", label: "Upload", icon: UploadCloud },
];

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 bg-brand text-white">
        <div className="flex h-14 items-center justify-between gap-4 px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-semibold">
            <FileText className="size-5" aria-hidden="true" />
            <span>Document Repository</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold"
                aria-hidden="true"
              >
                {initials(user.name)}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-semibold">{user.name}</span>
                <span className="block text-xs text-white/75">{user.departmentName}</span>
              </span>
            </div>
            <Button variant="onDark" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden="true" />
              Log out
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-line bg-white/60 md:w-56 md:border-r md:border-b-0">
          <nav aria-label="Main" className="flex gap-1 p-2 md:flex-col md:p-3">
            {links.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-brand-soft text-brand" : "text-muted hover:bg-page hover:text-ink"
                  }`}
                >
                  <Icon className="size-4.5" aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
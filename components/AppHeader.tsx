"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  function logout() {
    localStorage.removeItem("sg.password");
    router.push("/");
  }

  function refreshAccounts() {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent("app:refresh-accounts"));
    setTimeout(() => setRefreshing(false), 1500);
  }

  const link = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`text-sm transition-colors ${
          active ? "text-white font-medium" : "text-zinc-500 hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="flex items-center justify-between gap-4 mb-8 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap min-w-0">
        <div className="text-lg font-bold text-white shrink-0">Slideshow Generator</div>
        <nav className="flex items-center gap-4 flex-wrap">
          {link("/", "Home")}
          {link("/create", "Create")}
          {link("/books", "Books")}
          {link("/top-books", "Top Books")}
          {link("/excerpts", "Excerpts")}
          {link("/instagram", "Instagram")}
          {link("/posts", "Posts")}
          {link("/post-log", "Post Log")}
          {link("/chat", "Chat")}
          {link("/settings", "Settings")}
        </nav>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <button
          onClick={refreshAccounts}
          disabled={refreshing}
          className="text-sm text-blue-400 hover:text-blue-300 disabled:text-zinc-600 transition-colors"
          title="Re-fetch accounts from PostBridge"
        >
          {refreshing ? "Refreshing..." : "Refresh accounts"}
        </button>
        <button
          onClick={logout}
          className="text-sm text-zinc-500 hover:text-white transition-colors"
        >
          Log out
        </button>
      </div>
    </header>
  );
}

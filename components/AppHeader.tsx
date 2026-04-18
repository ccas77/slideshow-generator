"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    localStorage.removeItem("sg.password");
    router.push("/");
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
          {link("/instagram", "Instagram")}
          {link("/posts", "Posts")}
          {link("/chat", "Chat")}
        </nav>
      </div>
      <button
        onClick={logout}
        className="text-sm text-zinc-500 hover:text-white transition-colors shrink-0"
      >
        Log out
      </button>
    </header>
  );
}

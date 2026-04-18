"use client";

import { useState } from "react";

export default function HowItWorks({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        How this works
      </button>
      {open && (
        <div className="mt-2 text-xs text-zinc-400 leading-relaxed bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

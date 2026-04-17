"use client";

import { useState, useRef, useEffect } from "react";
import AppHeader from "@/components/AppHeader";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const LS_PC_KEY = "sg.pc_api_key";
const LS_PC_ACCOUNT = "sg.pc_account_id";

export default function ChatPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);

  const [pcApiKey, setPcApiKey] = useState("");
  const [pcAccountId, setPcAccountId] = useState("");
  const [pcSaved, setPcSaved] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load saved credentials
  useEffect(() => {
    const savedPw = localStorage.getItem("sg.password");
    if (savedPw) {
      setPassword(savedPw);
      setAuthed(true);
    }
    const savedKey = localStorage.getItem(LS_PC_KEY);
    const savedAcc = localStorage.getItem(LS_PC_ACCOUNT);
    if (savedKey && savedAcc) {
      setPcApiKey(savedKey);
      setPcAccountId(savedAcc);
      setPcSaved(true);
    }
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  const savePcCredentials = () => {
    if (!pcApiKey.trim() || !pcAccountId.trim()) return;
    localStorage.setItem(LS_PC_KEY, pcApiKey.trim());
    localStorage.setItem(LS_PC_ACCOUNT, pcAccountId.trim());
    setPcSaved(true);
  };

  const clearPcCredentials = () => {
    localStorage.removeItem(LS_PC_KEY);
    localStorage.removeItem(LS_PC_ACCOUNT);
    setPcApiKey("");
    setPcAccountId("");
    setPcSaved(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    const userMsg: Message = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-password": password,
        },
        body: JSON.stringify({
          messages: updated,
          pcApiKey,
          pcAccountId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMessages([...updated, { role: "assistant", content: data.text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // Auth gate
  if (!authed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black flex items-center justify-center">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password.trim()) {
              localStorage.setItem("sg.password", password.trim());
              setAuthed(true);
            }
          }}
          className="w-full max-w-sm px-6"
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/20 mb-4"
          />
          <button
            type="submit"
            className="w-full px-6 py-3 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  // PC credentials gate
  if (!pcSaved) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white">
        <div className="mx-auto w-full max-w-3xl px-6 sm:px-10 py-10">
          <AppHeader />
          <div className="max-w-md mx-auto mt-20">
            <h2 className="text-xl font-semibold mb-2">
              Connect Publisher Champ
            </h2>
            <p className="text-sm text-zinc-500 mb-6">
              Enter your Publisher Champ API key and account ID. These are saved
              locally on this device only.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={pcApiKey}
                  onChange={(e) => setPcApiKey(e.target.value)}
                  placeholder="Your Publisher Champ API key"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  Account ID
                </label>
                <input
                  type="text"
                  value={pcAccountId}
                  onChange={(e) => setPcAccountId(e.target.value)}
                  placeholder="Account UUID from Publisher Champ"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                />
              </div>
              <button
                onClick={savePcCredentials}
                disabled={!pcApiKey.trim() || !pcAccountId.trim()}
                className="w-full px-6 py-3 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-6 sm:px-10 py-10 flex flex-col flex-1 min-h-0">
        <AppHeader />

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Publisher Champ Chat</h2>
          <button
            onClick={clearPcCredentials}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Disconnect
          </button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto min-h-0 space-y-4 mb-4"
          style={{ maxHeight: "calc(100vh - 280px)" }}
        >
          {messages.length === 0 && !loading && (
            <div className="text-center py-20">
              <p className="text-zinc-500 text-sm mb-4">
                Ask anything about your publishing data
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  "How are my books doing this month?",
                  "What's my ad spend vs royalties this week?",
                  "Which book has the best ROI?",
                  "Show me my country breakdown for last month",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setInput(q);
                    }}
                    className="px-3 py-2 rounded-lg border border-zinc-800 text-xs text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-white text-black"
                    : "bg-zinc-800/80 text-zinc-200"
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-zinc-800/80 rounded-2xl px-4 py-3 flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-zinc-500">
                  Fetching your data...
                </span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-red-400 text-sm mb-2 text-center">{error}</p>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your sales, ads, royalties..."
            disabled={loading}
            autoFocus
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-3 rounded-xl bg-white text-black font-medium text-sm hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

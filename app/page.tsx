"use client";

import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";
import LoginScreen from "@/components/home/LoginScreen";
import AutomationTab from "@/components/home/AutomationTab";
import PostNowTab from "@/components/home/PostNowTab";
import { useAuth } from "@/hooks/useAuth";
import { useAccounts } from "@/hooks/useAccounts";
import { useBooks } from "@/hooks/useBooks";
import { useAccountData } from "@/hooks/useAccountData";
import type { Tab } from "@/types";

export default function Home() {
  const auth = useAuth();
  const { accounts, accountId, setAccountId, selectedAccount } = useAccounts(
    auth.authed,
    auth.password
  );
  const { books, saveBooks, loadSlideshowIntoEditor } = useBooks(
    auth.authed,
    auth.password
  );
  const accountData = useAccountData(
    accountId,
    auth.hydrated,
    auth.authed,
    auth.password
  );

  const [tab, setTab] = useState<Tab>("automation");

  if (!auth.authed) {
    return (
      <LoginScreen
        password={auth.password}
        setPassword={auth.setPassword}
        rememberMe={auth.rememberMe}
        setRememberMe={auth.setRememberMe}
        authError={auth.authError}
        onLogin={auth.login}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white">
      <div className="mx-auto w-full max-w-3xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Dashboard</strong> — manage your TikTok accounts and automate slideshow posting.</p>
          <p>Select a book and slideshow, pick which accounts to post to, and set time windows for automated daily posting. Each post gets a fresh AI-generated image.</p>
          <p>Use the automation toggle to enable/disable scheduled posting. Time windows are in UTC — one post is scheduled at a random time within each window.</p>
        </HowItWorks>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-xl bg-zinc-900/80 border border-zinc-800 mb-8">
          {([["automation", "Automation"], ["post-now", "Post Now"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-white text-black shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "automation" && (
          <AutomationTab
            accounts={accounts}
            accountId={accountId}
            setAccountId={setAccountId}
            loadingAccount={accountData.loadingAccount}
            config={accountData.config}
            setConfig={accountData.setConfig}
            lastRun={accountData.lastRun}
            lastStatus={accountData.lastStatus}
            books={books}
            expandedBooks={accountData.expandedBooks}
            setExpandedBooks={accountData.setExpandedBooks}
          />
        )}

        {tab === "post-now" && (
          <PostNowTab
            accounts={accounts}
            accountId={accountId}
            setAccountId={setAccountId}
            selectedAccount={selectedAccount}
            password={auth.password}
            books={books}
            saveBooks={saveBooks}
            loadSlideshowIntoEditor={loadSlideshowIntoEditor}
            imagePrompt={accountData.imagePrompt}
            setImagePrompt={accountData.setImagePrompt}
            bulkText={accountData.bulkText}
            setBulkText={accountData.setBulkText}
            caption={accountData.caption}
            setCaption={accountData.setCaption}
            setAuthFailed={auth.setAuthFailed}
          />
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

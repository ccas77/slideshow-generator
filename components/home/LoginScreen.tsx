"use client";

interface LoginScreenProps {
  password: string;
  setPassword: (v: string) => void;
  rememberMe: boolean;
  setRememberMe: (v: boolean) => void;
  authError: string;
  onLogin: () => void;
}

export default function LoginScreen({
  password,
  setPassword,
  rememberMe,
  setRememberMe,
  authError,
  onLogin,
}: LoginScreenProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur p-8 shadow-2xl">
          <h1 className="text-2xl font-bold text-white mb-2 text-center">
            Slideshow Generator
          </h1>
          <p className="text-sm text-zinc-500 mb-8 text-center">
            Enter password to continue
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onLogin();
            }}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/20 mb-4"
            />
            <label className="flex items-center gap-2 mb-5 text-sm text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="accent-white"
              />
              Remember me on this device
            </label>
            {authError && (
              <p className="text-red-400 text-sm mb-4">{authError}</p>
            )}
            <button
              type="submit"
              className="w-full px-6 py-3 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm"
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

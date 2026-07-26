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
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-white to-stone-100 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-stone-200 bg-white/70 backdrop-blur p-8 shadow-2xl">
          <h1 className="text-2xl font-bold text-stone-900 mb-2 text-center">
            Slideshow Generator
          </h1>
          <p className="text-sm text-stone-500 mb-8 text-center">
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
              className="w-full rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15 mb-4"
            />
            <label className="flex items-center gap-2 mb-5 text-sm text-stone-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="accent-stone-900"
              />
              Remember me on this device
            </label>
            {authError && (
              <p className="text-red-600 text-sm mb-4">{authError}</p>
            )}
            <button
              type="submit"
              className="w-full px-6 py-3 rounded-lg bg-stone-900 text-white font-semibold hover:bg-stone-700 transition-colors text-sm"
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

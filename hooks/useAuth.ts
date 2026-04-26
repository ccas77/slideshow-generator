"use client";

import { useState, useEffect } from "react";

const LS_PASSWORD = "sg.password";

export function useAuth() {
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate auth on mount
  useEffect(() => {
    try {
      const pw = localStorage.getItem(LS_PASSWORD);
      if (pw) {
        setPassword(pw);
        setAuthed(true);
      }
    } catch {}
    setHydrated(true);
  }, []);

  function login() {
    if (password.trim()) {
      setAuthed(true);
      setAuthError("");
      if (rememberMe) {
        localStorage.setItem(LS_PASSWORD, password);
      } else {
        localStorage.removeItem(LS_PASSWORD);
      }
    } else {
      setAuthError("Password is required");
    }
  }

  function logout() {
    localStorage.removeItem(LS_PASSWORD);
    setPassword("");
    setAuthed(false);
  }

  function setAuthFailed() {
    setAuthed(false);
    setAuthError("Wrong password. Try again.");
  }

  return {
    password,
    setPassword,
    rememberMe,
    setRememberMe,
    authed,
    authError,
    hydrated,
    login,
    logout,
    setAuthFailed,
  };
}

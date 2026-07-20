"use client";

import { useEffect, useState } from "react";
import { applyTheme, preferredTheme, themeStorageKey, type Theme } from "@/lib/theme";

export function LandingThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const nextTheme = preferredTheme();
    applyTheme(nextTheme);
    setTheme(nextTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem(themeStorageKey, nextTheme);
    setTheme(nextTheme);
  };

  return <button type="button" onClick={toggleTheme} aria-pressed={theme === "dark"} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="landing-theme-toggle min-h-11 rounded-xl px-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{theme === "dark" ? "Light mode" : "Dark mode"}</button>;
}

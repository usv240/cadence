"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function LandingThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const nextTheme: Theme = window.localStorage.getItem("cadence.theme") === "dark" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    setTheme(nextTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    window.localStorage.setItem("cadence.theme", nextTheme);
    setTheme(nextTheme);
  };

  return <button type="button" onClick={toggleTheme} aria-pressed={theme === "dark"} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="landing-theme-toggle min-h-11 rounded-xl px-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{theme === "dark" ? "Light mode" : "Dark mode"}</button>;
}

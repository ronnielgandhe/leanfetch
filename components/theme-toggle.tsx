"use client";

export function ThemeToggle() {
  const toggle = () => {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  };
  return (
    <button onClick={toggle} aria-label="toggle dark mode" className="font-mono text-[12px] text-muted hover:text-ink">
      <span className="dark:hidden">dark</span>
      <span className="hidden dark:inline">light</span>
    </button>
  );
}

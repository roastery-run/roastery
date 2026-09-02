/**
 * Theme selection, persisted in a cookie rather than localStorage.
 *
 * A cookie is readable by the inline script in index.html BEFORE React mounts,
 * which is what prevents the white flash a dark-mode user gets when the theme
 * is only known after hydration. localStorage would be readable there too, but
 * a cookie also reaches the Worker, so a server-rendered marketing page can
 * emit the right theme on the first byte.
 */
export type Theme = "light" | "dark" | "system";

const COOKIE = "roastery-theme";

export function readTheme(): Theme {
  if (typeof document === "undefined") return "system";
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`).exec(document.cookie);
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  // A year, and Lax: the theme is a preference, not a credential, and it must
  // survive the round trip through an OAuth provider on sign-in. Written
  // directly rather than through the Cookie Store API because the inline boot
  // script has to read it synchronously, before any module loads.
  // biome-ignore lint/suspicious/noDocumentCookie: must be readable synchronously at boot.
  document.cookie = `${COOKIE}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  applyTheme(theme);
}

/** The script inlined into each app's index.html, ahead of any stylesheet. */
export const THEME_BOOT_SCRIPT = `(()=>{try{var m=document.cookie.match(/(?:^|;\\s*)roastery-theme=([^;]*)/);var s=m?decodeURIComponent(m[1]):null;var d=s==="dark"||((s==="system"||!s)&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

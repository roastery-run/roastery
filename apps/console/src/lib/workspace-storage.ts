/**
 * What this device remembers about the workspace, and how it forgets it.
 *
 * Separate from `workspace.tsx` because signing out has to reach these keys,
 * and `workspace.tsx` imports the design system: pulling every component into
 * the auth guard's path to remove two strings is the wrong shape, and in a
 * test it drags in a toast library that wants a DOM.
 */

export const ORG_KEY = "roastery.org";
export const LOCATION_KEY = "roastery.location";

export const readWorkspaceKey = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    // A private window, or storage disabled. Not knowing the last org is a
    // minor inconvenience; throwing here would white-screen the whole app.
    return null;
  }
};

export const writeWorkspaceKey = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* as above */
  }
};

/**
 * Forgets which organization and location this device had selected.
 *
 * Part of signing out. `roastery.org` is read synchronously at mount and sent
 * as X-Roastery-Org on the first request, so leaving it behind means the next
 * person's first call is scoped to the previous person's organization. The API
 * rejects it, correctly — but it presents as a console that is simply broken
 * on the second person's login.
 */
export function clearWorkspaceSelection(): void {
  writeWorkspaceKey(ORG_KEY, null);
  writeWorkspaceKey(LOCATION_KEY, null);
}

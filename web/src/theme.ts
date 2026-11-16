// The app's colour theme: a standard light theme, and a dark theme with colour-blind-safe
// status colours (protanopia/deuteranopia) — blue/gold/violet instead of green/red/orange,
// matching GitHub's own "dark protanopia and deuteranopia" theme. Picked from the sidebar
// footer, applied via `data-theme` on <html> (see the `:root[data-theme='dark-cb']` block
// in styles.css), and remembered across visits.
import { ref, watch } from 'vue';

export type Theme = 'light' | 'dark-cb';

/** The theme switcher's options, shared by the sidebar footer and the login page. */
export const THEMES: { id: Theme; icon: string; label: string }[] = [
  { id: 'light', icon: '☀️', label: 'Light' },
  { id: 'dark-cb', icon: '🌙', label: 'Dark (colour-blind safe)' },
];

const LS_KEY = 'pb_theme';

function stored(): Theme {
  return localStorage.getItem(LS_KEY) === 'dark-cb' ? 'dark-cb' : 'light';
}

export const theme = ref<Theme>(stored());

function apply(t: Theme): void {
  if (t === 'light') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function setTheme(t: Theme): void {
  theme.value = t;
}

watch(
  theme,
  (t) => {
    apply(t);
    localStorage.setItem(LS_KEY, t);
  },
  { immediate: true },
);

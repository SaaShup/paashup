// xterm.js glue for the container Logs / Terminal panels. xterm and its fit addon are
// loaded from a CDN in index.html (see the <script> tags there) and expose globals, so
// nothing here is bundled; `hasXterm()` lets a panel degrade gracefully if the CDN was
// unreachable.

/** Terminal colours (same palette as the Docker agent's own console). */
export const XTERM_THEME = {
  foreground: '#F8F8F8',
  background: '#2D2E2C',
  cursor: '#F8F8F8',
  selectionBackground: '#5DA5D555',
  black: '#1E1E1D',
  brightBlack: '#8a8a88',
  red: '#CE5C5C',
  brightRed: '#FF7272',
  green: '#5BCC5B',
  brightGreen: '#72FF72',
  yellow: '#CCCC5B',
  brightYellow: '#FFFF72',
  blue: '#5D5DD3',
  brightBlue: '#7279FF',
  magenta: '#BC5ED1',
  brightMagenta: '#E572FF',
  cyan: '#5DA5D5',
  brightCyan: '#72F0FF',
  white: '#F8F8F8',
  brightWhite: '#FFFFFF',
};

export const XTERM_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function hasXterm(): boolean {
  return typeof Terminal !== 'undefined' && typeof FitAddon !== 'undefined';
}

/** A terminal opened in `el` with the fit addon attached and fitted once. */
export function openTerminal(
  el: HTMLElement,
  options: Record<string, unknown> = {},
): { term: XTerminal; fit: XFitAddon } {
  const term = new Terminal({
    theme: XTERM_THEME,
    fontFamily: XTERM_FONT,
    fontSize: 13,
    ...options,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  safeFit(fit);
  return { term, fit };
}

/** fit() throws while the element has no layout (hidden tab) — ignore that. */
export function safeFit(fit: XFitAddon): void {
  try {
    fit.fit();
  } catch {
    /* not laid out yet */
  }
}

export function stripDockerFrames(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x02]\x00\x00\x00[\x00-\x7f�]{1,4}/g, '');
}

/** `\n` → `\r\n` for a terminal that doesn't convert EOL itself. */
export function crlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

// ---- real (browser) fullscreen -------------------------------------------------------

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
}

export function isFullscreen(el: Element): boolean {
  return document.fullscreenElement === el;
}

/** Enter/leave browser fullscreen on `el` (no-op where the API is unavailable). */
export async function toggleFullscreen(el: HTMLElement): Promise<void> {
  if (!fullscreenSupported()) return;
  try {
    if (isFullscreen(el)) await document.exitFullscreen();
    else await el.requestFullscreen();
  } catch {
    /* denied by the browser (needs a user gesture) */
  }
}

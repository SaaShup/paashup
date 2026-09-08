// Minimal typings for the xterm.js + fit addon UMD globals loaded from the CDN in
// index.html (@xterm/xterm 5.x exposes `Terminal`, @xterm/addon-fit exposes `FitAddon`).
// Only the surface the app uses is declared.

interface XTerminalOptions {
  theme?: Record<string, string>;
  fontFamily?: string;
  fontSize?: number;
  cursorBlink?: boolean;
  disableStdin?: boolean;
  convertEol?: boolean;
  scrollback?: number;
  [key: string]: unknown;
}

interface XDisposable {
  dispose(): void;
}

interface XTerminal {
  readonly cols: number;
  readonly rows: number;
  readonly element: HTMLElement | undefined;
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array, callback?: () => void): void;
  writeln(data: string | Uint8Array, callback?: () => void): void;
  reset(): void;
  clear(): void;
  focus(): void;
  scrollToBottom(): void;
  loadAddon(addon: unknown): void;
  onData(listener: (data: string) => void): XDisposable;
  onResize(listener: (size: { cols: number; rows: number }) => void): XDisposable;
  dispose(): void;
}

interface XFitAddon {
  fit(): void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
  dispose(): void;
}

declare const Terminal: new (options?: XTerminalOptions) => XTerminal;
declare const FitAddon: { FitAddon: new () => XFitAddon };

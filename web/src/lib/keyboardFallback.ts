import type { SerialFrame } from '@/types/contracts';

export type KeyboardPeakEvent = CustomEvent<SerialFrame>;
export type KeyboardModeEvent = CustomEvent<{ active: boolean }>;

const HOTKEY_CODE = 'Space';
const SYNTHETIC_DEPTH = 0.7;

export class KeyboardFallback extends EventTarget {
  private active = false;
  private lastPressMs = 0;

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === HOTKEY_CODE && event.altKey && event.shiftKey) {
      event.preventDefault();
      this.setActive(!this.active);
      return;
    }
    if (
      this.active &&
      event.code === HOTKEY_CODE &&
      !event.altKey &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      this.synthesizePeak();
    }
  };

  start(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKeyDown);
  }

  stop(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onKeyDown);
  }

  isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.lastPressMs = 0;
    this.dispatchEvent(
      new CustomEvent<{ active: boolean }>('mode', { detail: { active } }),
    );
    console.info(`[C2] keyboard fallback ${active ? 'on' : 'off'}`);
  }

  private synthesizePeak(): void {
    const nowMs = Date.now();
    const interval = this.lastPressMs > 0 ? nowMs - this.lastPressMs : 0;
    const rate = interval > 0 ? Math.min(220, Math.round(60000 / interval)) : 0;
    this.lastPressMs = nowMs;
    const frame: SerialFrame = { depth: SYNTHETIC_DEPTH, rate, ts: nowMs };
    this.dispatchEvent(new CustomEvent<SerialFrame>('peak', { detail: frame }));
  }
}

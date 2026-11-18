import { Component, Injectable, inject, signal } from '@angular/core';

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private next = 1;

  show(text: string, kind: Toast['kind'] = 'info', ms = 3800) {
    const t = { id: this.next++, text, kind };
    this.items.update((l) => [...l, t]);
    setTimeout(() => this.items.update((l) => l.filter((x) => x.id !== t.id)), ms);
  }
  error(text: string) {
    this.show(text, 'error', 6000);
  }
}

@Component({
  selector: 'app-toasts',
  template: `
    <div class="toasts" role="status" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <div class="toast" [class.error]="t.kind === 'error'">{{ t.text }}</div>
      }
    </div>
  `,
  styles: `
    .toasts { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 100;
      display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; width: min(560px, calc(100% - 32px)); }
    .toast { background: var(--ink); color: var(--shell); padding: 12px 18px; border-radius: 14px; font-size: 13px;
      box-shadow: 0 12px 30px rgba(0,0,0,.2); max-width: 100%; }
    .toast.error { background: var(--red); color: #fff; }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
}

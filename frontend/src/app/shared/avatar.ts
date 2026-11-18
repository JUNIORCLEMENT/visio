import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { avatarClass, initials } from '../core/labels';

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="av {{ cls() }} {{ size() }}" aria-hidden="true">{{ text() }}</span>`,
  styles: `:host { display: inline-flex; }`,
})
export class Avatar {
  readonly name = input<string | null | undefined>('');
  readonly size = input<'' | 'm' | 'l'>('');
  protected readonly text = computed(() => initials(this.name()));
  protected readonly cls = computed(() => avatarClass(this.name()));
}

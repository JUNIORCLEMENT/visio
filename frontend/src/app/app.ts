import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IncomingCallAlert } from './core/live';
import { ToastHost } from './core/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost, IncomingCallAlert],
  template: `<router-outlet /><app-incoming-call /><app-toasts />`,
})
export class App {}

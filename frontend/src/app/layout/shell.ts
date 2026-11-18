import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../core/auth';
import { LiveUpdates } from '../core/live';
import { ROLE_LABELS } from '../core/labels';
import { Avatar } from '../shared/avatar';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Avatar, Icon],
  template: `
    <div class="app">

      <!-- Sidebar blanche style Google Duo -->
      <nav class="sidebar" aria-label="Navigation principale">

        <!-- Logo -->
        <div class="sidebar-logo">
          <div class="logo-icon">
            <img class="logo-light" src="assets/logo-mark-light.png" alt="" />
            <img class="logo-dark"  src="assets/logo-mark-dark.png"  alt="" />
          </div>
          <span class="logo-text">HPO Visio</span>
        </div>

        <!-- Nav items -->
        <ul class="nav-list" role="list">
          <li>
            <a class="nav-item" routerLink="/accueil" routerLinkActive="active" ariaCurrentWhenActive="page">
              <span class="nav-icon"><app-icon name="home" [size]="19"/></span>
              <span>Accueil</span>
            </a>
          </li>
          <li>
            <a class="nav-item" routerLink="/calendrier" routerLinkActive="active" ariaCurrentWhenActive="page">
              <span class="nav-icon"><app-icon name="calendar" [size]="19"/></span>
              <span>Calendrier</span>
            </a>
          </li>
          <li>
            <a class="nav-item" routerLink="/activite" routerLinkActive="active" ariaCurrentWhenActive="page">
              <span class="nav-icon">
                <app-icon name="bell" [size]="19"/>
                @if (live.unread()) {
                  <span class="notif-dot">{{ live.unread() > 9 ? '9+' : live.unread() }}</span>
                }
              </span>
              <span>Activité</span>
            </a>
          </li>
          <li>
            <a class="nav-item" routerLink="/contacts" routerLinkActive="active" ariaCurrentWhenActive="page">
              <span class="nav-icon"><app-icon name="contacts" [size]="19"/></span>
              <span>Contacts</span>
            </a>
          </li>
          <li>
            <a class="nav-item" routerLink="/comptes-rendus" routerLinkActive="active" ariaCurrentWhenActive="page">
              <span class="nav-icon"><app-icon name="doc" [size]="19"/></span>
              <span>Comptes rendus</span>
            </a>
          </li>
          @if (auth.isAdmin()) {
            <li>
              <a class="nav-item" routerLink="/admin" routerLinkActive="active" ariaCurrentWhenActive="page">
                <span class="nav-icon"><app-icon name="shield" [size]="19"/></span>
                <span>Administration</span>
              </a>
            </li>
          }
        </ul>

        <!-- Bas de sidebar : profil -->
        <div class="sidebar-foot">
          <button class="profile-btn" type="button"
            (click)="menu.set(!menu())"
            [attr.aria-expanded]="menu()"
            aria-label="Mon compte">
            <app-avatar [name]="auth.user()?.fullName" />
            <div class="profile-text">
              <span class="profile-name">{{ auth.user()?.fullName }}</span>
              <span class="profile-sub">{{ roleLabel() }}</span>
            </div>
          </button>

          @if (menu()) {
            <div class="profile-menu" role="menu">
              <div class="pm-head">
                <app-avatar [name]="auth.user()?.fullName" size="m" />
                <div>
                  <p class="pm-name">{{ auth.user()?.fullName }}</p>
                  <p class="pm-email">{{ auth.user()?.email }}</p>
                </div>
              </div>
              <hr class="pm-sep" />
              <button type="button" class="pm-item logout" role="menuitem" (click)="auth.logout()">
                <app-icon name="logout" [size]="16"/> Se déconnecter
              </button>
            </div>
          }
        </div>
      </nav>

      <!-- Contenu -->
      <main class="content" (click)="menu.set(false)">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    /* ---- Layout ---------------------------------------------------- */
    .app {
      display: flex;
      min-height: 100vh;
      background: #F0F2F8;
    }

    /* ---- Sidebar --------------------------------------------------- */
    .sidebar {
      flex: 0 0 230px;
      background: #fff;
      border-right: 1px solid #E8EAF0;
      display: flex;
      flex-direction: column;
      padding: 24px 16px 20px;
      gap: 6px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      box-shadow: 2px 0 12px rgba(43,15,134,.04);
    }

    /* Logo */
    .sidebar-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 8px 24px;
    }
    .logo-icon {
      width: 36px; height: 36px;
      border-radius: 10px;
      background: #2B0F86;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; padding: 6px;
    }
    .logo-icon img { width: 100%; filter: brightness(0) invert(1); }
    .logo-text {
      font-size: 16px;
      font-weight: 700;
      color: #16131F;
      letter-spacing: -.02em;
    }

    /* Nav list */
    .nav-list {
      list-style: none;
      margin: 0; padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 46px;
      padding: 0 14px;
      border-radius: 14px;
      color: #625D72;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none !important;
      transition: background .12s, color .12s;
    }
    .nav-item:hover {
      background: #F0F2F8;
      color: #16131F;
      text-decoration: none !important;
    }
    .nav-item.active {
      background: #EBF0FF;
      color: #2B0F86;
      font-weight: 600;
    }

    .nav-icon {
      position: relative;
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px;
      flex: none;
    }
    .notif-dot {
      position: absolute;
      top: -5px; right: -6px;
      min-width: 15px; height: 15px;
      padding: 0 3px;
      border-radius: 999px;
      background: #E5323B;
      color: #fff;
      font-size: 9px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }

    /* Profil bas */
    .sidebar-foot { position: relative; margin-top: auto; padding-top: 16px; border-top: 1px solid #F0F2F8; }

    .profile-btn {
      width: 100%;
      display: flex; align-items: center; gap: 10px;
      padding: 10px 10px;
      border-radius: 12px; border: none;
      background: transparent;
      cursor: pointer; text-align: left;
      transition: background .12s;
    }
    .profile-btn:hover { background: #F0F2F8; }
    .profile-text { flex: 1; min-width: 0; }
    .profile-name {
      display: block;
      font-size: 13px; font-weight: 600; color: #16131F;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .profile-sub { font-size: 11px; color: #8E889E; }

    /* Menu profil */
    .profile-menu {
      position: absolute;
      bottom: calc(100% + 8px); left: 0; right: 0;
      background: #fff;
      border: 1px solid #E8EAF0;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,.12);
      overflow: hidden; z-index: 50;
    }
    .pm-head { display: flex; align-items: center; gap: 10px; padding: 14px; }
    .pm-name { font-size: 13px; font-weight: 600; color: #16131F; margin: 0; }
    .pm-email { font-size: 11px; color: #8E889E; margin: 0; }
    .pm-sep { border: none; border-top: 1px solid #F0F2F8; margin: 0; }
    .pm-item {
      width: 100%; display: flex; align-items: center; gap: 10px;
      padding: 11px 14px; border: none; background: transparent;
      font-size: 13px; font-weight: 500; color: #625D72;
      cursor: pointer; text-align: left;
      transition: background .1s;
    }
    .pm-item:hover { background: #F0F2F8; }
    .pm-item.logout { color: #E5323B; }
    .pm-item.logout:hover { background: #FDE8E9; }

    /* ---- Contenu --------------------------------------------------- */
    .content {
      flex: 1;
      min-width: 0;
      padding: 28px 32px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* ---- Responsive ------------------------------------------------ */
    @media (max-width: 900px) {
      .sidebar {
        position: fixed; bottom: 0; left: 0; right: 0; top: auto;
        height: 64px; flex-direction: row; align-items: center;
        justify-content: space-around; padding: 0 8px;
        border-right: none; border-top: 1px solid #E8EAF0;
        z-index: 40; gap: 0;
      }
      .sidebar-logo { display: none; }
      .nav-list { flex-direction: row; flex: none; gap: 0; }
      .nav-item { flex-direction: column; gap: 2px; height: 56px; padding: 6px 10px; border-radius: 10px; font-size: 10px; }
      .nav-item.active { background: transparent; color: #2B0F86; }
      .sidebar-foot { margin: 0; padding: 0; border: none; }
      .profile-text { display: none; }
      .profile-btn { padding: 6px; border-radius: 50%; width: 44px; height: 44px; justify-content: center; }
      .profile-menu { bottom: 68px; left: auto; right: 8px; width: 240px; }
      .content { padding: 16px 16px 80px; }
    }
  `,
})
export class Shell {
  protected readonly auth = inject(Auth);
  protected readonly live = inject(LiveUpdates);
  protected readonly menu = signal(false);
  protected roleLabel() {
    const r = this.auth.user()?.role;
    return r ? ROLE_LABELS[r] : '';
  }
}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="auth-root">

      <!-- Côté gauche : visuel immersif -->
      <div class="visual" aria-hidden="true">
        <div class="visual-overlay"></div>
        <img class="visual-bg" src="assets/login-photo.jpg" alt="" />

        <div class="visual-content">
          <div class="visual-logo">
            <img src="assets/logo-full-dark.png" alt="HPO & Associés" />
          </div>

          <div class="visual-center">
            <div class="visual-pill">Plateforme de visioconférence</div>
            <h2 class="visual-title">{{ tagline() }}</h2>
            <p class="visual-desc">
              Organisez vos réunions, invitez vos collègues et retrouvez vos comptes rendus en un clic.
            </p>
          </div>

          <div class="visual-stats">
            <div class="stat">
              <span class="stat-num">HD</span>
              <span class="stat-lbl">Vidéo</span>
            </div>
            <div class="stat-sep"></div>
            <div class="stat">
              <span class="stat-num">100%</span>
              <span class="stat-lbl">Sécurisé</span>
            </div>
            <div class="stat-sep"></div>
            <div class="stat">
              <span class="stat-num">Auto</span>
              <span class="stat-lbl">Comptes rendus</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Côté droit : formulaire -->
      <div class="form-side">
        <div class="form-side-inner">
          <div class="mobile-logo">
            <img class="logo-light" src="assets/logo-full-light.png" alt="HPO & Associés" />
            <img class="logo-dark"  src="assets/logo-full-dark.png"  alt="HPO & Associés" />
          </div>
          <ng-content />
        </div>
        <p class="form-copy">© {{ year }} HPO &amp; Associés — usage interne</p>
      </div>

    </div>
  `,
  styles: `
    :host { display: block; }

    /* ------------------------------------------------------------------ */
    /*  Racine                                                              */
    /* ------------------------------------------------------------------ */
    .auth-root {
      display: flex;
      min-height: 100vh;
      background: #0c0a14;
    }

    /* ------------------------------------------------------------------ */
    /*  Visuel gauche                                                       */
    /* ------------------------------------------------------------------ */
    .visual {
      position: relative;
      flex: 0 0 52%;
      overflow: hidden;
    }
    .visual-bg {
      position: absolute;
      inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      object-position: center;
      filter: saturate(.8);
    }
    .visual-overlay {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(135deg,
          rgba(10,4,40,.92)  0%,
          rgba(32,3,111,.82) 45%,
          rgba(60,20,160,.65) 100%);
      z-index: 1;
    }

    /* Grille de points décorative */
    .visual::before {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 2;
      background-image: radial-gradient(circle, rgba(255,255,255,.07) 1px, transparent 1px);
      background-size: 32px 32px;
      pointer-events: none;
    }

    .visual-content {
      position: relative;
      z-index: 3;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 44px 48px;
    }

    /* Logo */
    .visual-logo img {
      height: 36px;
      filter: brightness(0) invert(1);
      opacity: .92;
    }

    /* Centre */
    .visual-center { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 20px; }

    .visual-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      padding: 6px 16px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.18);
      background: rgba(255,255,255,.08);
      backdrop-filter: blur(10px);
      font-size: 12px;
      font-weight: 600;
      color: #c4b5fd;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .visual-pill::before {
      content: '';
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #a78bfa;
      flex: none;
      box-shadow: 0 0 6px #a78bfa;
    }

    .visual-title {
      font-size: clamp(28px, 3.2vw, 42px);
      font-weight: 800;
      line-height: 1.12;
      letter-spacing: -.03em;
      color: #fff;
      max-width: 440px;
      margin: 0;
    }

    .visual-desc {
      font-size: 15px;
      color: rgba(255,255,255,.6);
      line-height: 1.6;
      max-width: 380px;
      margin: 0;
    }

    /* Stats */
    .visual-stats {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 20px 24px;
      border-radius: 20px;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.1);
      backdrop-filter: blur(16px);
    }
    .stat { display: flex; flex-direction: column; gap: 2px; }
    .stat-num { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -.02em; }
    .stat-lbl { font-size: 11px; color: rgba(255,255,255,.5); font-weight: 500; text-transform: uppercase; letter-spacing: .05em; }
    .stat-sep { width: 1px; height: 32px; background: rgba(255,255,255,.12); }

    /* ------------------------------------------------------------------ */
    /*  Formulaire droit                                                    */
    /* ------------------------------------------------------------------ */
    .form-side {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 48px 40px;
      background: var(--shell, #fff);
    }
    .form-side-inner {
      width: 100%;
      max-width: 420px;
      display: flex;
      flex-direction: column;
      gap: 32px;
      flex: 1;
      justify-content: center;
    }
    .mobile-logo { display: none; }
    .mobile-logo img { height: 32px; }
    .form-copy {
      font-size: 11.5px;
      color: var(--faint, #9ca3af);
      text-align: center;
    }

    /* ------------------------------------------------------------------ */
    /*  Responsive                                                          */
    /* ------------------------------------------------------------------ */
    @media (max-width: 860px) {
      .auth-root { background: var(--shell, #fff); }
      .visual { display: none; }
      .form-side { padding: 40px 24px; justify-content: flex-start; }
      .form-side-inner { justify-content: flex-start; }
      .mobile-logo { display: block; }
    }
  `,
})
export class AuthLayout {
  readonly tagline = input('Travaillez ensemble, où que vous soyez.');
  readonly year = new Date().getFullYear();
}

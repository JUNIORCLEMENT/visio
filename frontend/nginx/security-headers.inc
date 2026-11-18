# En-têtes de sécurité (inclus dans chaque « location » : nginx n'hérite pas des add_header)
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "same-origin" always;
add_header Permissions-Policy "camera=(self), microphone=(self), display-capture=(self), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

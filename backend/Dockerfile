# --- ÉTAPE 1 : Compilation du Front-end Angular ---
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend

# Copie et installation des dépendances du front
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

# Copie du code front et build de production
COPY frontend/ ./
RUN npx ng build --configuration production


# --- ÉTAPE 2 : Image finale de production (Back-end + Front intégré) ---
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production

# Installation des dépendances du back-end
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copie du code source du back-end et des assets
COPY src ./src
COPY assets ./assets

# Récupération des fichiers Angular compilés depuis l'étape 1 dans un dossier "public"
COPY --from=frontend-build /app/frontend/dist/frontend/browser ./public

# Render injecte dynamiquement le port, on ne met plus de port fixe
EXPOSE 10000

# Healthcheck adapté au port dynamique ou à l'endpoint de ton back
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-10000}/api/health || exit 1

# On lance ton serveur Node.js (qui sert aussi le dossier public d'Angular)
CMD ["node", "src/server.js"]
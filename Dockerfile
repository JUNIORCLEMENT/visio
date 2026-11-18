# --- Étape 1 : Compilation du Front-end Angular ---
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx ng build --configuration production


# --- Étape 2 : Image finale (Back-end Node.js + Front intégré) ---
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production

# Copie depuis le dossier backend/ vers la racine du conteneur (/app)
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copie du code source et des assets depuis backend/
COPY backend/src ./src
COPY backend/assets ./assets

# Récupération des fichiers Angular compilés depuis l'étape 1
COPY --from=frontend-build /app/frontend/dist/frontend/browser ./public

ENV PORT=10000
EXPOSE 10000

CMD ["node", "src/server.js"]
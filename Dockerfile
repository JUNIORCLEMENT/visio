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

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY assets ./assets

# Récupération des fichiers Angular compilés depuis l'étape 1
COPY --from=frontend-build /app/frontend/dist/frontend/browser ./public

ENV PORT=10000
EXPOSE 10000

CMD ["node", "src/server.js"]
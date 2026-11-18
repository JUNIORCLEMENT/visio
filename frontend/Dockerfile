# --- Étape 1 : compilation Angular ------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build --configuration production

# --- Étape 2 : service par nginx --------------------------------------
FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80

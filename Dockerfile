FROM node:24.13.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY frontend/admin-dashboard/package.json frontend/admin-dashboard/package.json
COPY backend/server/package.json backend/server/package.json
COPY shared/package.json shared/package.json
COPY freellmapi/desktop/package.json freellmapi/desktop/package.json
RUN npm ci --no-audit --no-fund
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build

FROM node:24.13.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOST=0.0.0.0 PORT=3000 BACKEND_PORT=3001
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data /app/backend/server/data /app/frontend/public/generated_posters && chown -R node:node /app/data /app/backend/server/data /app/frontend/public/generated_posters
USER node
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "Promise.all([fetch('http://127.0.0.1:3000'),fetch('http://127.0.0.1:3001/api/ping')]).then(r=>process.exit(r.every(x=>x.ok)?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]

# --- Build: compile TypeScript to dist/ ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Run: production dependencies and compiled code only ---
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

# The uploads volume is mounted here; the folder must belong to the non-root user
RUN mkdir -p uploads && chown node:node uploads
USER node

EXPOSE 3001

# Apply migrations, optionally add the demo users and documents, then start the API.
# exec hands the process over to node so it receives Docker's stop signal.
CMD ["sh", "-c", "node dist/db/migrate.js && if [ \"$SEED_DEMO_DATA\" = \"true\" ]; then node dist/db/seed.js; fi && exec node dist/server.js"]

# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Install deps first so the layer caches independently of source changes.
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# NODE_ENV is supplied at run time (see docker-compose.yml) rather than baked in,
# because it also gates the DEV_AUTH_BYPASS guard in src/auth.js — a local
# compose run needs to be able to set `development`.
EXPOSE 4000

CMD ["node", "src/server.js"]

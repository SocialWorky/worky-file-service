# Build stage for dependencies
FROM node:22.1.0-alpine3.18 as deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# Build stage for development dependencies
FROM node:22.1.0-alpine3.18 as dev-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# Build stage for building the application
FROM node:22.1.0-alpine3.18 as builder
WORKDIR /app
COPY --from=dev-deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Final stage for production
FROM node:22.1.0-alpine3.18 as prod
WORKDIR /app
ENV APP_VERSION=${APP_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Install libvips and ffmpeg
RUN apk add --no-cache libvips ffmpeg

CMD ["node", "dist/main.js"]

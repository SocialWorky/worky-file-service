# Use the ffmpeg image as a base
FROM jrottenberg/ffmpeg:4.4-alpine as base

# Install libvips
RUN apk add --no-cache --repository http://dl-cdn.alpinelinux.org/alpine/v3.14/main/ vips-dev

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
FROM base as prod
WORKDIR /app
ENV APP_VERSION=${APP_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main.js"]

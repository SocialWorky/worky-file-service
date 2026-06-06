# Use the official Node.js 22.1.0 image as a base image
FROM node:22.1.0-alpine3.18 as base

# Install build dependencies for libvips and ffmpeg
RUN apk add --no-cache \
    build-base \
    gcc \
    g++ \
    make \
    pkgconf \
    vips-dev \
    ffmpeg \
    && rm -rf /var/cache/apk/* 

# Build stage for dependencies
FROM base as deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# Build stage for development dependencies
FROM base as dev-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# Build stage for building the application
FROM base as builder
WORKDIR /app
COPY --from=dev-deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Final stage for production
FROM base as prod
# Use ARG to make port configurable at build time
ARG APP_PORT=3005
# Expose the port (will use ARG value)
EXPOSE ${APP_PORT}
WORKDIR /app
# Set APP_PORT as environment variable (can be overridden at runtime)
ENV APP_PORT=${APP_PORT}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main.js"]

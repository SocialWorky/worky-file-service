FROM node:22.1.0-alpine3.18 as dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "start:dev"]

FROM node:22.1.0-alpine3.18 as dev-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# Instalación de libvips y ffmpeg
RUN apk --no-cache add \
    vips \
    ffmpeg

FROM node:22.1.0-alpine3.18 as builder
WORKDIR /app
COPY --from=dev-deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.1.0-alpine3.18 as prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production --frozen-lockfile

# Instalación de libvips y ffmpeg
RUN apk --no-cache add \
    vips \
    ffmpeg

FROM node:22.1.0-alpine3.18 as prod
WORKDIR /app
ENV APP_VERSION=${APP_VERSION}
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Instalación de libvips y ffmpeg
RUN apk --no-cache add \
    vips \
    ffmpeg

CMD ["node","dist/main.js"]

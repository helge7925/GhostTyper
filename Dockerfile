# Stage 1: Install dependencies
FROM node:20.20.2-alpine3.23@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build the application
FROM node:20.20.2-alpine3.23@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN mkdir -p /app/pdf-fonts/noto-sans/files \
    /app/pdf-fonts/noto-sans-arabic/files \
    /app/pdf-fonts/noto-sans-sc/files \
    /app/pdf-fonts/noto-sans-tc/files && \
    cp node_modules/@fontsource/noto-sans/LICENSE node_modules/@fontsource/noto-sans/unicode.json /app/pdf-fonts/noto-sans/ && \
    cp node_modules/@fontsource/noto-sans/files/*.woff /app/pdf-fonts/noto-sans/files/ && \
    cp node_modules/@fontsource/noto-sans-arabic/LICENSE node_modules/@fontsource/noto-sans-arabic/unicode.json /app/pdf-fonts/noto-sans-arabic/ && \
    cp node_modules/@fontsource/noto-sans-arabic/files/*-400-normal.woff /app/pdf-fonts/noto-sans-arabic/files/ && \
    cp node_modules/@fontsource/noto-sans-sc/LICENSE node_modules/@fontsource/noto-sans-sc/unicode.json /app/pdf-fonts/noto-sans-sc/ && \
    cp node_modules/@fontsource/noto-sans-sc/files/*-400-normal.woff /app/pdf-fonts/noto-sans-sc/files/ && \
    cp node_modules/@fontsource/noto-sans-tc/LICENSE node_modules/@fontsource/noto-sans-tc/unicode.json /app/pdf-fonts/noto-sans-tc/ && \
    cp node_modules/@fontsource/noto-sans-tc/files/*-400-normal.woff /app/pdf-fonts/noto-sans-tc/files/

# Stage 3: Production runner
FROM node:20.20.2-alpine3.23@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/pdf-fonts ./pdf-fonts

RUN apk add --no-cache ffmpeg chromium nss freetype harfbuzz ttf-freefont \
    font-noto-cjk
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WRANGLER_LOG_PATH=/tmp/wrangler.log

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build

EXPOSE 3000

CMD ["pnpm", "start", "--hostname", "0.0.0.0"]

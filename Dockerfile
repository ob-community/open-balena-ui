FROM node:24-alpine AS base

ENV NODE_ENV=production

WORKDIR /usr/src/app
COPY ./package.json ./
COPY ./package-lock.json ./

RUN npm install --no-fund --no-update-notifier --no-audit \
    && npm cache clean --force

FROM base AS builder

COPY ./server ./server
COPY ./src ./src
COPY ./public ./public
COPY ./types ./types
COPY ./index.html ./
COPY ./tsconfig*.json ./
COPY ./vite.config.mts ./
COPY ./types.d.ts ./

RUN NODE_ENV=development npm install --no-fund --no-update-notifier --no-audit \
    && npm cache clean --force \
    && npm run build

FROM base AS production-image

COPY --from=builder /usr/src/app/server/ /usr/src/app/server/
COPY --from=builder /usr/src/app/dist/ /usr/src/app/dist/
COPY --from=builder /usr/src/app/index.html /usr/src/app/index.html
COPY --from=builder /usr/src/app/public/ /usr/src/app/public/

CMD ["npm", "run", "serve"]
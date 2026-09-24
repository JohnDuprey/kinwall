FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
RUN mkdir -p /data && chown node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "src/node.ts"]

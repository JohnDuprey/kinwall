FROM node:24-bookworm-slim AS node_runtime
FROM mcr.microsoft.com/playwright:v1.65.1-noble
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
ENV PATH=/usr/local/bin:$PATH
WORKDIR /e2e
COPY package*.json ./
RUN npm ci
ENV NODE_PATH=/e2e/node_modules
ENTRYPOINT ["node"]

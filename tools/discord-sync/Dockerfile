FROM node:24.11.1-alpine
WORKDIR /bridge
COPY *.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV SYNC_DATA_DIR=/data SYNC_HOST=0.0.0.0 SYNC_PORT=8098
EXPOSE 8098
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 CMD node -e "fetch('http://127.0.0.1:8098/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "cli.mjs", "run", "--apply"]

# The relayer, for a host that runs a long-lived process.
#
# Built from `services/` rather than the repo root, because the npm workspace that resolves `viem`
# lives here and nothing above it is needed to run.
#
# Node 24, not 22: `src/index.ts` is executed directly and relies on type stripping being on by
# default, which it is from 23.6. On 22 the process would exit on the first type annotation.
FROM node:24-alpine

# Tini, so SIGTERM reaches node and the HTTP server closes its sockets instead of being killed
# mid-request when the platform redeploys.
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
COPY relayer/package.json relayer/
COPY matcher/package.json matcher/
RUN npm ci --omit=dev --workspace rail-relayer --include-workspace-root

COPY relayer relayer
COPY matcher matcher

# The encrypted vault and recipient details live on a mounted volume, not in the image layer.
# Without a volume at this path they are lost on redeploy, which loses every saved recipient.
ENV VAULT_DIR=/data/vault
ENV RECIPIENT_DIR=/data/recipients
RUN mkdir -p /data/vault /data/recipients

# Runs unprivileged: nothing here needs root, and the node image already ships a `node` user.
RUN chown -R node:node /data /app
USER node

ENV PORT=8787
EXPOSE 8787

# No shell form, so signals are not swallowed by an intermediate shell.
WORKDIR /app/relayer
CMD ["node", "src/index.ts"]

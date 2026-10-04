# The chat bot, for a host that keeps a process alive.
#
# It needs no inbound port and no public URL: long polling means it asks Telegram for updates rather
# than waiting to be called. That is why Telegram is the pilot transport, and it is also why this
# container can sit anywhere with outbound internet.
#
# Node 24, not 22: src/index.ts is executed directly and relies on type stripping being on by
# default, which it is from 23.6.
FROM node:24-alpine

# Tini, so SIGTERM reaches node and the poll loop exits cleanly instead of being killed mid-reply.
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src src

# Unprivileged: nothing here needs root, and the node image already ships a `node` user.
USER node

# No shell form, so signals are not swallowed by an intermediate shell. No --env-file: on a host
# the configuration comes from real environment variables, never a file in the image.
CMD ["node", "src/index.ts"]

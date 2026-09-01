# Presence server only — deliberately NOT the whole repo. The city client is
# static on Vercel; this image carries one file and one dependency so it boots
# in well under a second when Fly wakes it for the first visitor.
FROM node:22-alpine

WORKDIR /app
COPY server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY server/presence.mjs ./presence.mjs

ENV PORT=8787
EXPOSE 8787
CMD ["node", "presence.mjs"]

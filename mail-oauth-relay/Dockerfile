FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY lib.mjs server.mjs ./
USER node
CMD ["node", "server.mjs"]

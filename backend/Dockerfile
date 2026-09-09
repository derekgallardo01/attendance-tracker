FROM node:20-slim

WORKDIR /app

COPY package*.json ./
# npm ci: install EXACTLY the lockfile CI tested — `npm install` could resolve
# newer in-range minors inside the image, shipping a dependency tree no test
# suite ever ran against.
RUN npm ci --omit=dev

COPY server.js .
COPY src/ ./src/
COPY public/ ./public/

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]

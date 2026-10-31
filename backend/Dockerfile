FROM node:22-slim

WORKDIR /app

COPY package*.json ./
# npm ci: install EXACTLY the lockfile CI tested — `npm install` could resolve
# newer in-range minors inside the image, shipping a dependency tree no test
# suite ever ran against.
RUN npm ci --omit=dev

COPY server.js .
COPY src/ ./src/
COPY public/ ./public/
# PDF fonts: the committed base Noto Sans (Latin/Cyrillic/Greek) plus the
# per-script faces (Arabic, Devanagari, Thai, CJK, ...) fetched at build time
# so certificates/reports never print non-Latin names as empty boxes.
COPY assets/ ./assets/
COPY scripts/fetch-fonts.js ./scripts/
RUN node scripts/fetch-fonts.js

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]

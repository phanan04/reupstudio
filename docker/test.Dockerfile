FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server/ server/
COPY public/ public/
COPY scripts/ scripts/
COPY tests/ tests/
ENV VIETSTUDIO_ENV_FILE=""
RUN npm run check && npm test
CMD ["npm", "test"]

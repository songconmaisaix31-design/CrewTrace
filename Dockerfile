FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/runtime/package.json services/runtime/package.json
RUN npm ci
COPY apps/web apps/web
COPY services/runtime services/runtime
RUN npm run build
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["npm", "start"]

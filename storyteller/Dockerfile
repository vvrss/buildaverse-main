# Storyteller: the app, the Community API and its pictures, as one server.
# Build:  docker build -t storyteller .
# Run:    docker run -p 8080:8080 -v storyteller-data:/data \
#           -e PUBLIC_ORIGIN=https://stories.example.com \
#           -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='a long secret' storyteller
# Keep /data on a persistent disk: it holds the database and every picture.

FROM node:22.22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22.22-slim
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/main.js"]

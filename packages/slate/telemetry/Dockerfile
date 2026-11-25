FROM node:24-bookworm-slim
WORKDIR /app
# Build Slate before building this image, from the repository root.
# Only the server's database adapter needs an external runtime dependency.
COPY packages/slate/package.json package.json
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); p.dependencies={pg:p.peerDependencies.pg}; delete p.peerDependencies; delete p.peerDependenciesMeta; p.devDependencies={}; fs.writeFileSync('package.json',JSON.stringify(p))" && npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY packages/slate/dist dist
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "dist/telemetry/server/main.js"]

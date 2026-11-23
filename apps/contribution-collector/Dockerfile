FROM node:24-bookworm-slim
WORKDIR /app
# Build Slate and the collector before building this image, from the repository root.
COPY apps/contribution-collector/package.json package.json
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); delete p.dependencies['@darkgrade/slate']; p.devDependencies={}; fs.writeFileSync('package.json',JSON.stringify(p))" && npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY packages/slate/package.json node_modules/@darkgrade/slate/package.json
COPY packages/slate/dist node_modules/@darkgrade/slate/dist
COPY apps/contribution-collector/dist dist
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]

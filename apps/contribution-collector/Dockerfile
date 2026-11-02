FROM node:24-bookworm-slim
WORKDIR /app
# Build/typecheck both workspaces before building this image, from the repository root.
COPY packages/contribute/package.json node_modules/@darkgrade/contribute/package.json
COPY packages/contribute/dist node_modules/@darkgrade/contribute/dist
COPY apps/contribution-collector/package.json package.json
COPY apps/contribution-collector/dist dist
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]

# Build stage
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Production stage
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package.json bun.lock ./

# Install only production dependencies
RUN bun install --production --frozen-lockfile

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create uploads directory with proper permissions
RUN mkdir -p /app/uploads

# Create non-root user (Debian based)
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -m nodejs

# Change ownership of app directory to nodejs user
RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

CMD ["bun", "dist/index.js"] 

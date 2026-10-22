# exposomeql MCP — HHEAR-only deployment image (Node + Python, no R/NHANES).
# All HHEAR cohort tools are Python (pandas/numpy/scipy/statsmodels); the R-backed
# tools are NHANES-only and are disabled when no NHANES database is mounted.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pandas python3-numpy python3-scipy python3-statsmodels \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# HHEAR-only mode: EXPOSOMEQL_DATA_DIR points at a path with no NHANES sqlite, so
# NHANES/CTD attaches are skipped (see config.ts + duckdb-manager). HHEAR cohort
# CSVs are mounted at /data/hhear.
ENV NODE_ENV=production \
    EXPOSOMEQL_PORT=3001 \
    EXPOSOMEQL_DATA_DIR=/data/nhanes-absent \
    HHEAR_DATA_DIR=/data/hhear

EXPOSE 3001
CMD ["node", "dist/index-http.js"]

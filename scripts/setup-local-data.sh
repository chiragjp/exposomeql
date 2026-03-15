#!/bin/bash
# Setup local data directory for ExposomeQL
# This creates a local (non-Dropbox) data directory with symlinks to the actual database files.
# Avoids Dropbox smart sync causing 0-byte file stubs.
#
# Usage: bash scripts/setup-local-data.sh [DATA_SOURCE_DIR]
#
# DATA_SOURCE_DIR defaults to ../nhanespewas/db (relative to project root)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOCAL_DATA_DIR="${HOME}/.exposomeql/data"
SOURCE_DIR="${1:-$(cd "$PROJECT_DIR/../nhanespewas/db" 2>/dev/null && pwd)}"

if [ -z "$SOURCE_DIR" ] || [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Cannot find data source directory."
  echo "Usage: bash scripts/setup-local-data.sh /path/to/nhanespewas/db"
  exit 1
fi

echo "ExposomeQL Local Data Setup"
echo "==========================="
echo "Source:      $SOURCE_DIR"
echo "Local dir:   $LOCAL_DATA_DIR"
echo ""

# Create local data directory
mkdir -p "$LOCAL_DATA_DIR"

# Symlink database files (these are the ones that get smart-synced to 0 bytes)
DATABASES=(
  "nhanes_031725.sqlite"
  "pe_summary_stats_01_2025.sqlite"
  "ee_summary_stats_03_2024.sqlite"
)

for db in "${DATABASES[@]}"; do
  src="$SOURCE_DIR/$db"
  dst="$LOCAL_DATA_DIR/$db"
  if [ -f "$src" ]; then
    size=$(stat -f%z "$src" 2>/dev/null || stat -c%s "$src" 2>/dev/null)
    if [ "$size" -gt 0 ]; then
      ln -sf "$src" "$dst"
      echo "  ✓ Linked $db ($(echo "$size" | awk '{printf "%.1fGB", $1/1073741824}'))"
    else
      echo "  ✗ Skipped $db (0 bytes — Dropbox not synced)"
    fi
  else
    echo "  ✗ Not found: $db"
  fi
done

# Symlink CTD parquet directory
CTD_SRC="$PROJECT_DIR/data/ctd/parquet"
CTD_DST="$LOCAL_DATA_DIR/ctd"
if [ -d "$CTD_SRC" ]; then
  mkdir -p "$LOCAL_DATA_DIR/ctd"
  ln -sf "$CTD_SRC" "$LOCAL_DATA_DIR/ctd/parquet"
  echo "  ✓ Linked CTD parquet directory"
fi

# Symlink parquet directory if exists
PARQUET_SRC="$SOURCE_DIR/parquet"
if [ -d "$PARQUET_SRC" ]; then
  ln -sf "$PARQUET_SRC" "$LOCAL_DATA_DIR/parquet"
  echo "  ✓ Linked parquet directory"
fi

# Create the data symlink in the project (or update it)
DATA_LINK="$PROJECT_DIR/data"
if [ -L "$DATA_LINK" ]; then
  echo ""
  echo "Note: $DATA_LINK is already a symlink → $(readlink "$DATA_LINK")"
  echo "To use local data, either:"
  echo "  1. Set env var: export EXPOSOMEQL_DATA_DIR=$LOCAL_DATA_DIR"
  echo "  2. Update symlink: ln -sf $LOCAL_DATA_DIR $DATA_LINK"
else
  echo ""
  echo "To use local data, set:"
  echo "  export EXPOSOMEQL_DATA_DIR=$LOCAL_DATA_DIR"
fi

echo ""
echo "Done. Add to your shell profile:"
echo "  export EXPOSOMEQL_DATA_DIR=$LOCAL_DATA_DIR"
echo ""
echo "Or in MCP client config:"
echo '  "env": { "EXPOSOMEQL_DATA_DIR": "'$LOCAL_DATA_DIR'" }'

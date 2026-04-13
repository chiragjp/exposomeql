#!/bin/bash
# Wrapper for Claude Desktop — ensures the server stays alive
# Claude Desktop may disconnect if it doesn't get stdio response fast enough
cd "$(dirname "$0")/.."
exec node dist/index.js

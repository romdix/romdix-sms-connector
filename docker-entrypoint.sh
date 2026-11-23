#!/bin/sh
set -e

# The /app/data volume may be owned by root from an earlier image version.
# Make it writable for the unprivileged user before dropping privileges.
if [ -d /app/data ]; then
  chown -R node:node /app/data 2>/dev/null || true
fi

exec su-exec node "$@"

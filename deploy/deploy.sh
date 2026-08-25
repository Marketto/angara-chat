#!/bin/sh
set -eu

# A changing build ID invalidates the PWA precache and lets the client compare
# its bundle with the API before continuing to use a cached installation.
export BUILD_VERSION="deploy-$(date -u +%Y%m%dT%H%M%SZ)"
docker compose up -d --build

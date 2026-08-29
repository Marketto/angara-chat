#!/bin/sh
set -eu

# A changing build ID invalidates the PWA precache and lets the client compare
# its bundle with the API before continuing to use a cached installation.
export BUILD_VERSION="deploy-$(date -u +%Y%m%dT%H%M%SZ)"

# Keep the small shared VPS from filling up with dangling Angara release
# images. Never run global Docker prune commands here: VPN resources and other
# services may share the Docker daemon.
cleanup_angara_images() {
  stale_images=$(docker image ls -q --filter dangling=true --filter label=com.angara.managed=true)
  if [ -n "$stale_images" ]; then docker image rm $stale_images; fi
}

cleanup_angara_images
docker compose up -d --build
# The Caddyfile is mounted as a single file. Archive-based releases replace its
# inode, so an already-running container can keep seeing the previous mount.
# Recreate only Caddy to bind the current policy without restarting the app.
docker compose up -d --force-recreate --no-deps caddy
cleanup_angara_images

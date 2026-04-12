# syntax=docker/dockerfile:1.6

# Thin overlay on the official OpenClaw image. No OpenClaw build step —
# we only add the Railway-specific entrypoint and config template.
# OpenClaw publishes pre-built images to GitHub Container Registry (not Docker Hub).
FROM ghcr.io/openclaw/openclaw:latest

USER root

# envsubst ships with gettext-base. curl is used by entrypoint.sh to
# pre-install marketplace plugins (e.g. Index Network). Install only the
# ones that are missing so rebuilds stay cheap when the base image
# already includes them. `$needs` is intentionally word-split into the
# apt-get argv (no arrays in /bin/sh); suppressed below.
# hadolint ignore=SC2086
RUN set -eux; \
    needs=""; \
    command -v envsubst >/dev/null 2>&1 || needs="$needs gettext-base"; \
    command -v curl >/dev/null 2>&1 || needs="$needs curl"; \
    if [ -n "$needs" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends $needs \
      && rm -rf /var/lib/apt/lists/*; \
    fi

COPY config.json5.template /opt/openclaw-railway/config.json5.template
COPY --chmod=0755 entrypoint.sh /opt/openclaw-railway/entrypoint.sh

# Intentionally NOT dropping to USER node. Railway mounts the persistent
# volume at /data as root-owned, and volume mounts shadow any pre-chown done
# in the image. Running the entrypoint as root lets mkdir "$XDG_CONFIG_HOME"
# succeed against the freshly-mounted volume. Root-inside-container is not
# root-on-host; the real trust boundaries (gateway token, hooks token,
# keyring password, CORS allowedOrigins) are unaffected.

ENTRYPOINT ["/opt/openclaw-railway/entrypoint.sh"]

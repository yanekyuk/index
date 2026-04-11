# syntax=docker/dockerfile:1.6

# Thin overlay on the official OpenClaw image. No OpenClaw build step —
# we only add the Railway-specific entrypoint and config template.
FROM openclaw/openclaw:latest

USER root

# envsubst ships with gettext-base. Install only if missing so rebuilds are
# cheap when the base image already includes it.
RUN if ! command -v envsubst >/dev/null 2>&1; then \
      apt-get update \
      && apt-get install -y --no-install-recommends gettext-base \
      && rm -rf /var/lib/apt/lists/*; \
    fi

COPY --chown=node:node config.json5.template /opt/openclaw-railway/config.json5.template
COPY --chown=node:node --chmod=0755 entrypoint.sh /opt/openclaw-railway/entrypoint.sh

USER node

ENTRYPOINT ["/opt/openclaw-railway/entrypoint.sh"]

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TOML="$REPO_ROOT/railway.toml"

if [ ! -f "$TOML" ]; then
  echo "FAIL: $TOML does not exist"
  exit 1
fi

# Parse TOML using python3's tomllib (Python 3.11+). Fall back to `taplo` if unavailable.
if python3 -c 'import tomllib' 2>/dev/null; then
  python3 -c "
import tomllib, sys
with open('$TOML', 'rb') as f:
    data = tomllib.load(f)
assert data['build']['builder'] == 'DOCKERFILE', 'build.builder must be DOCKERFILE'
assert data['build']['dockerfilePath'] == 'Dockerfile', 'build.dockerfilePath must be Dockerfile'
assert data['deploy']['restartPolicyType'] == 'on_failure', 'deploy.restartPolicyType must be on_failure'
assert 'healthcheckPath' not in data['deploy'], 'deploy.healthcheckPath must be absent'
print('OK: railway.toml parsed and assertions passed')
"
elif command -v taplo >/dev/null 2>&1; then
  taplo check "$TOML"
else
  echo "FAIL: neither python3 tomllib nor taplo is available"
  exit 1
fi

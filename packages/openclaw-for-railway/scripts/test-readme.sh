#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
README="$REPO_ROOT/README.md"

if [ ! -f "$README" ]; then
  echo "FAIL: $README does not exist"
  exit 1
fi

# Required sections (by heading text match, case-insensitive)
for section in 'Deploy on Railway' 'What this deploys' 'What you must supply' 'After deploy' 'Verify the webhook' "What's not included"; do
  grep -qi "$section" "$README" || { echo "FAIL: README missing section: $section"; exit 1; }
done

# Deploy button must be a markdown image linked to a railway.com URL.
grep -Eq '!\[[^]]*\]\(https://railway\.com/button\.svg\)\]\(https://railway\.com/(new/template|deploy)/' "$README" || {
  echo "FAIL: README missing Deploy on Railway button with railway.com target"
  exit 1
}

echo "OK: README has all required sections and deploy button"

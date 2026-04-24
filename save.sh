#!/bin/bash
# save.sh — commit + push workflow for BrickQuest
#
# Usage:
#   ./save.sh "message"          # commit + push only
#   ./save.sh -v "message"       # bump patch version (0.11.0 → 0.11.1) + commit + push
#   ./save.sh -V "message"       # bump minor version (0.11.0 → 0.12.0) + commit + push
#   ./save.sh --major "message"  # bump major version (0.11.0 → 1.0.0) + commit + push
#
# The version flag uses `npm version --no-git-tag-version` which edits
# package.json in place but does NOT create a git tag (we commit normally).

cd ~/Desktop/BrickQuest

# Refuse to commit if there are no real code changes.
# Without this, accidental double-runs (e.g., from a mis-paste) produce
# meaningless version-bump-only commits. We check the working tree for
# any modified file other than package.json. If everything's already
# committed (or only package.json drifted), exit cleanly.
REAL_CHANGES=$(git status --porcelain | grep -v ' package.json$' | grep -v ' package-lock.json$')
if [ -z "$REAL_CHANGES" ]; then
  echo "No code changes detected. Nothing to commit."
  echo "(If you meant to commit a version-only bump, run: git commit --allow-empty -m '...')"
  exit 0
fi

BUMP=""

# Parse optional version flag
if [ "$1" == "-v" ] || [ "$1" == "--patch" ]; then
  BUMP="patch"
  shift
elif [ "$1" == "-V" ] || [ "$1" == "--minor" ]; then
  BUMP="minor"
  shift
elif [ "$1" == "--major" ]; then
  BUMP="major"
  shift
fi

MSG="${1:-update}"

if [ -n "$BUMP" ]; then
  NEW_VERSION=$(npm version $BUMP --no-git-tag-version | tr -d 'v')
  MSG="v$NEW_VERSION: $MSG"
  echo "Version bumped to $NEW_VERSION"
fi

git add .
git commit -m "$MSG"
git push
echo "Saved to GitHub!"

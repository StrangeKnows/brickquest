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

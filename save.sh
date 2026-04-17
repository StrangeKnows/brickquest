#!/bin/bash
cd ~/Desktop/BrickQuest
git add .
git commit -m "${1:-update}"
git push
echo "Saved to GitHub!"

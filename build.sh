#!/bin/bash

# Ensure script fails on any error
set -e

# Colors for output
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
NC="\033[0m" # No Color

# Force x64 build for macOS 10.12
echo -e "${YELLOW}Configuring for Intel x64 (macOS 10.12)...${NC}"
npm pkg set config.arch=x64
BUILD_ARCH="x64"

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${YELLOW}Current version: ${CURRENT_VERSION}${NC}"

# Increment patch version
NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')

# Update version in package.json
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
echo -e "${GREEN}Updated version to: ${NEW_VERSION}${NC}"

# Clean previous builds
echo -e "${YELLOW}Cleaning previous builds...${NC}"
rm -rf dist

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install

# Build the app
echo -e "${YELLOW}Building application...${NC}"
./node_modules/.bin/electron-builder --mac --x64 \
  --config.mac.target=dmg \
  --config.dmg.writeUpdateInfo=false \
  --config.mac.minimumSystemVersion=10.12

echo -e "${GREEN}Build complete!${NC}"
echo -e "${GREEN}New version: ${NEW_VERSION}${NC}"
echo -e "${YELLOW}Build available in: ./dist${NC}"

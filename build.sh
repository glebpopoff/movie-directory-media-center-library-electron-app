#!/bin/bash

# Ensure script fails on any error
set -e

# Get the system architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    echo "Building for Apple Silicon (ARM64)..."
    # Update package.json config arch if needed
    npm pkg set config.arch=arm64
elif [ "$ARCH" = "x86_64" ]; then
    echo "Building for Intel (x64)..."
    # Update package.json config arch if needed
    npm pkg set config.arch=x64
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Run the build
echo "Building application..."
npm run build

echo "Build completed successfully!"

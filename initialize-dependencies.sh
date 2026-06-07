#!/bin/bash
# Install project dependencies

npm install
if [ $? -eq 0 ]; then
  echo "Dependencies installed successfully."
else
  echo "Failed to install dependencies." >&2
  exit 1
fi
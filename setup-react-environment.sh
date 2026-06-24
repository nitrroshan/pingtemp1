#!/bin/bash

# Clone the repository
if [ -z "$1" ]; then
  echo "Usage: $0 <repository-url>"
  exit 1
fi

git clone "$1" project-dir
cd project-dir

# Initialize React project
npx create-react-app my-dashboard --template typescript

# Navigate to React project directory
cd my-dashboard

# Install charting libraries
npm install recharts chart.js

# Install styling frameworks
npm install @mui/material @emotion/react @emotion/styled

# Return to project root and install dependencies
cd ..
npm install

# Success message
echo "React development environment is set up successfully!"
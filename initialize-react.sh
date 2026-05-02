#!/bin/bash

# Initialize React project
npx create-react-app my-dashboard --template typescript

# Navigate to project directory
cd my-dashboard

# Install charting libraries
npm install recharts chart.js

# Install styling frameworks
npm install @mui/material @emotion/react @emotion/styled

# Add README details
cat <<EOT >> README.md
# My Dashboard

This project includes:
- TypeScript setup
- Charting libraries: Recharts, Chart.js
- Styling framework: MUI

EOT
# Start with an official Node.js image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Expose the application port
EXPOSE 3000

# Define the command to run the application
CMD [ "npm", "start" ]
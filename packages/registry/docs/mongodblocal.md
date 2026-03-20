# MongoDB Local Atlas Deployment Guide

This guide covers how to install dependencies, set up a local Atlas deployment, and connect to it.

## 1. Installation

### Required Tools
- [Atlas CLI](https://www.mongodb.com/docs/atlas/cli/install-atlas-cli/)
- [Docker](https://www.docker.com/)
- (Optional) [mongosh](https://www.mongodb.com/docs/mongodb-shell/install/)
- (Optional) [Compass](https://www.mongodb.com/docs/compass/current/install/)
- (Optional) [Visual Studio Code](https://code.visualstudio.com/download) and [MongoDB for VS Code Extension](https://www.mongodb.com/docs/mongodb-vscode/install/)

#### Example (MacOS):
```sh
brew install mongodb-atlas-cli
brew install mongosh
brew install mongodb-compass
```

For other OS, see the official installation links above.

## 2. Setup Local Atlas Deployment

### Get latest Atlas
docker pull mongodb/atlas

### Create an Atlas Account
If you don't have an Atlas account, run:
```sh
atlas setup
```
Or [create a new account online](https://account.mongodb.com/account/register).

### Create a Local Deployment (Interactive)
```sh
atlas deployments setup
```
Follow the prompts to select `local - Local Database` and choose default or custom settings.

#### To initialize with your own data:
```sh
atlas deployments setup --initdb {folder}
```
Replace `{folder}` with the directory containing your `.js` and `.sh` files.

### Create a Local Deployment (Non-Interactive)
```sh
atlas deployments setup myLocalRs1 --type local --force
```

## 3. Connect to the Deployment

To connect to your deployment:
```sh
atlas deployments connect
```
Select the deployment and choose your preferred connection method (e.g., mongosh, Compass, VS Code, or copy the connection string).

#### Example connection string:
```
mongodb://localhost:27017/?directConnection=true
```

## 4. Pause your Deployments

To pause your local deployment
```sh
atlas deployments pause
```

## 5. Logs for the Atlas Deployments

To pause your local deployment
```sh
atlas deployments logs
```

## 6. Delete an Atlas Deployments

To pause your local deployment
```sh
atlas deployments delete
```

For more commands and management options, see the [Atlas CLI documentation](https://www.mongodb.com/docs/atlas/cli/command/atlas-deployments/).
[Atlas local deploy documentation](https://www.mongodb.com/docs/atlas/cli/current/atlas-cli-deploy-local/)
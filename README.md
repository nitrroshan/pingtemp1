# Notes API

This project is a REST API for managing notes. It is built using Node.js, Express, and Sequelize.

## Project Structure

```
/src
  /auth         # Authentication and Authorization modules
  /notes        # Notes-related features
  /middleware   # Middleware for request handling
  /models       # Sequelize models and database interaction
  /routes       # API routes
  /utils        # Utility functions
  /db.ts        # Database connection setup
  server.ts     # Entry point of the application
```

## Getting Started

### Prerequisites

- Node.js >= 14.x
- MySQL server

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables by creating a `.env` file:
   ```env
   DB_NAME=your_database_name
   DB_USER=your_database_user
   DB_PASSWORD=your_database_password
   DB_HOST=localhost
   PORT=3000
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

### Testing Database Connection

Ensure the database connection is configured correctly. On server startup, a message will indicate if the database connection is successful or not.

## Scripts

- `npm run dev`: Start the development server with hot-reloading.
- `npm run build`: Compile TypeScript to JavaScript.
- `npm start`: Run the production server.

## Dependencies

- **Express**: Web framework for Node.js
- **Sequelize**: ORM for database interaction
- **dotenv**: Environment variable management
- **mysql2**: MySQL driver for Node.js
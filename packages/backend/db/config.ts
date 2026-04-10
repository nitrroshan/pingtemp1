import mongoose from "mongoose";
import dotenv from "dotenv";
import { rootLogger } from "../logging/index.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const logger = rootLogger.child({ module: "worker/database" });

// Load .env from src/worker directory
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

async function connectDB(): Promise<void> {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable is not defined");
    }

    await mongoose.connect(`${process.env.MONGODB_URI}`);

    logger.info("Connected to MongoDB");
  } catch (err) {
    logger.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

async function disconnectDB(): Promise<void> {
  try {
    await mongoose.connection.close();
    logger.info("MongoDB connection closed");
  } catch (err) {
    logger.error("Error closing MongoDB connection:", err);
    throw err;
  }
}

/** Drop all data from all collections (for dev reset only) */
async function resetDB(): Promise<void> {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    try {
      await collections[key]?.deleteMany({});
      logger.info(`Cleared collection: ${key}`);
    } catch (err) {
      logger.warn(`Failed to clear collection ${key}:`, err);
    }
  }
  logger.info("All collections cleared");
}

export default connectDB;
export { disconnectDB, resetDB };

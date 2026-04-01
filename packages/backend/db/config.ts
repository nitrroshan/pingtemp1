import mongoose from "mongoose";
import dotenv from "dotenv";
import { Logger } from "tslog";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const logger = new Logger({ name: "worker/database" });

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
    // Clear all collections before disconnecting
    const collections = mongoose.connection.collections;

    for (const key in collections) {
      const collection = collections[key];
      try {
        await collection?.deleteMany({});
        logger.info(`Cleared collection: ${key}`);
      } catch (err) {
        logger.warn(`Failed to clear collection ${key}:`, err);
      }
    }

    await mongoose.connection.close();
    logger.info("MongoDB connection closed");
  } catch (err) {
    logger.error("Error closing MongoDB connection:", err);
    throw err;
  }
}

export default connectDB;
export { disconnectDB };

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Logger } from "tslog";
import { agentSchema, AgentModel } from "../schema/agentSchema";
import { agentSearchIndex } from "../schema/searchIndex/agentSearchIndex";

const logger = new Logger({ name: "agentRegistry/database" });
dotenv.config();

async function connectDB(): Promise<void> {
  try {
    if (!process.env.MONGO_URL) {
      throw new Error("MONGO_URL environment variable is not defined");
    }

    await mongoose.connect(`${process.env.MONGO_URL}`);

    await registerSearchIndex();

    logger.info("Connected to MongoDB");
  } catch (err) {
    logger.error("MongoDB connection error:", err);
    process.exit(1); // Exit process with failure
  } finally {
    // mongoose.connection.close();
    // await AgentModel.dropSearchIndex(agentSearchIndex.name);
  }
}

async function registerSearchIndex(): Promise<void> {
  try {
    agentSchema.searchIndex(agentSearchIndex);
    await AgentModel.createSearchIndexes();
    logger.info("Registered Search Index");
  } catch (err) {
    logger.error("Error registering search index:", err);
  }
}

export default connectDB;

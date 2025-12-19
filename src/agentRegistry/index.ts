import express, { Request, Response } from "express";
import { Logger } from "tslog";
import { Agent, IAgent } from "./types/agent";
import { AgentCapability, IAgentCapability } from "./types/agentCapability";
import { AgentModel } from "./schema/agentSchema";
import { TryGenerateEmbedding } from "./util";
import connectDB from "./db/db";
import performVectorQuery from "./db/vectorQuery";
import { agentSearchIndex } from "./schema/searchIndex/agentSearchIndex";

const app = express();
const port = process.env.PORT || 3000;

const logger = new Logger({ name: "agentRegistry/server" });
app.use(express.json()); // for parsing application/json

app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});

app.post("/agent/register", async (req: Request, res: Response) => {
  try {
    const agentData = req.body;
    const agentName: string = agentData.name;
    const agentDescription: string = agentData.description;

    const agentCapabilities: AgentCapability[] = agentData.capabilities.map(
      (cap: IAgentCapability) => {
        if (!cap.name || !cap.description || !cap.level) {
          logger.error("Invalid capability data:", cap);
          res.status(400).json({ error: "Invalid capability data" });
        }
        return new AgentCapability(cap.name, cap.description, cap.level);
      }
    );
    const agentEmbeddingResult = await TryGenerateEmbedding(
      agentData.description + " " + agentName
    );

    if (!agentEmbeddingResult.result) {
      logger.error("Failed to generate embedding for agent");
      res.status(500).json({ error: "Failed to generate embedding for agent" });
      return;
    }

    const agentEmbedding = agentEmbeddingResult.value;

    const newAgent: IAgent = new Agent({
      name: agentName,
      description: agentDescription,
      capabilities: agentCapabilities,
      status: "available",
      mcpEndpoint: agentData.mcpEndpoint || "",
      embedding: agentEmbedding,
    });
    const agent = new AgentModel(newAgent);
    const savedAgent = await agent.save();

    if (!savedAgent) {
      logger.error("Failed to create new agent");
      res.status(500).json({ error: "Failed to create new agent" });
    }

    logger.info("Agent registered:", savedAgent?._id);
    res.status(201).json({ agent: savedAgent });
  } catch (error) {
    logger.error("Error registering agent:", error);
    res.status(400).json({ error: error });
  }
});

app.post("/agent/discover", async (req: Request, res: Response) => {
  const data = req.body;

  const query: string = data.query || "";
  const queryEmbeddingResult = await TryGenerateEmbedding(query);
  if (!queryEmbeddingResult.result) {
    logger.error("Failed to generate embedding for query");
    res.status(500).json({ error: "Failed to generate embedding for query" });
    return;
  }
  // Discovery logic would go here
  const agents = await performVectorQuery({
    collectionName: "agents",
    fieldPath: "embedding",
    queryVector: queryEmbeddingResult.value,
    indexName: agentSearchIndex.name,
    limit: 5,
  });

  res.status(200).json({ agents });
});

app.listen(port, async () => {
  await connectDB();
  logger.info(`Server running at http://localhost:${port}`);
});

export default app;

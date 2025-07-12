import { Agent, AgentCapability } from "../../types/agent";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import { Embeddings } from "@langchain/core/embeddings";

// Level hierarchy definition
const CAPABILITY_LEVELS = [
  "basic",
  "intermediate",
  "advanced",
  "expert",
] as const;

type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

// Registers services provided by agents
export class ServiceRegistry {
  private agents: Map<string, Agent> = new Map();
  private embeddings: Embeddings;
  private similarityThreshold = 0.3;

  constructor() {
    this.embeddings = new AzureOpenAIEmbeddings({
      azureOpenAIEndpoint: process.env.AZURE_OPENAI_EMBEDDINGS_ENDPOINT_URL!,
      azureOpenAIApiKey: process.env.AZURE_OPENAI_EMBEDDINGS_API_KEY!,
      azureOpenAIApiInstanceName:
        process.env.AZURE_OPENAI_EMBEDDINGS_INSTANCE_NAME!,
      azureOpenAIApiDeploymentName: "text-embedding-3-large",
      azureOpenAIApiVersion: "2023-05-15",
    });
  }

  /**
   * Register a new agent
   */
  async registerAgent(
    agent: Omit<Agent, "id" | "status" | "created_at" | "last_heartbeat">
  ) {
    // Validate capabilities
    if (!agent.capabilities || agent.capabilities.length === 0) {
      throw new Error("Agent must declare capabilities");
    }

    const agentId = `local-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 5)}`;
    const newAgent: Agent = {
      ...agent,
      id: agentId,
      status: "available",
      created_at: new Date(),
      last_heartbeat: new Date(),
    };

    // Store agent
    this.agents.set(agentId, newAgent);

    // Notify subscribers
    this.notifySubscribers(newAgent);
  }

  /**
   * Discover local agents matching required capabilities
   *
   * @param requiredCapabilities - Capabilities to filter by
   * @param includeStatus - Whether to include agent status in results
   * @returns Array of matching agents
   */
  async discoverAgents(
    requiredCapabilities?: AgentCapability[],
    includeStatus: boolean = false
  ): Promise<Agent[]> {
    // 1. Get all agent IDs
    const agentIds = Array.from(this.agents.keys());

    // 2. Fetch agent details in parallel
    const agents = await Promise.all(
      agentIds.map((id) => this.getAgentDetails(id, includeStatus))
    );

    // 3. Filter out null values
    const validAgents = agents.filter((a): a is Agent => a !== null);

    return validAgents;

    // 4. Filter by capabilities if provided
    // return requiredCapabilities
    //   ? this.filterByCapabilities(validAgents, requiredCapabilities)
    //   : validAgents;
  }

  /**
   * Get agent details with optional status verification
   */
  private async getAgentDetails(
    agentId: string,
    verifyStatus: boolean
  ): Promise<Agent | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // // Verify status if requested
    // if (verifyStatus) {
    //   agent.status = await this.verifyAgentStatus(agent);
    // }

    return agent;
  }

  /**
   * Enhanced capability matching with semantic understanding
   */
  async filterByCapabilities(
    agents: Agent[],
    requiredCapabilities: AgentCapability[]
  ): Promise<Agent[]> {
    if (requiredCapabilities.length === 0) return agents;

    // Create embeddings for required capabilities
    const requiredEmbeddings = await this.embeddings.embedDocuments(
      requiredCapabilities.map(this.capabilityToText)
    );

    // Score agents and filter
    const agentScores = await Promise.all(
      agents.map((agent) =>
        this.scoreAgent(agent, requiredCapabilities, requiredEmbeddings)
      )
    );

    return agentScores
      .filter(({ score }) => score >= this.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .map(({ agent }) => agent);
  }

  /**
   * Calculate agent's match score for required capabilities
   */
  private async scoreAgent(
    agent: Agent,
    requiredCaps: AgentCapability[],
    requiredEmbeddings: number[][]
  ): Promise<{ agent: Agent; score: number }> {
    // Create embeddings for agent capabilities
    const agentTexts = agent.capabilities.map(this.capabilityToText);
    const agentEmbeddings = await this.embeddings.embedDocuments(agentTexts);

    let totalScore = 0;
    let matchCount = 0;

    // Find best match for each required capability
    for (const [idx, reqCap] of requiredCaps.entries()) {
      const reqEmbedding = requiredEmbeddings[idx];
      let bestMatch = { similarity: 0, levelWeight: 0 };

      for (const [j, agentCap] of agent.capabilities.entries()) {
        const similarity = this.cosineSimilarity(
          reqEmbedding,
          agentEmbeddings[j]
        );
        const levelWeight = this.calculateLevelWeight(agentCap, reqCap);
        const capabilityScore = similarity * levelWeight;

        if (capabilityScore > bestMatch.similarity) {
          bestMatch = { similarity, levelWeight };
        }
      }

      // Only count if above minimum similarity threshold
      if (bestMatch.similarity > 0.5) {
        totalScore += bestMatch.similarity * bestMatch.levelWeight;
        matchCount++;
      }
    }

    // Calculate average score, penalize for missing capabilities
    const coverage = matchCount / requiredCaps.length;
    const score = matchCount > 0 ? (totalScore / matchCount) * coverage : 0;

    return { agent, score };
  }

  /**
   * Calculate level compatibility weight (0-1)
   */
  private calculateLevelWeight(
    agentCap: AgentCapability,
    requiredCap: AgentCapability
  ): number {
    const agentLevel = this.normalizeLevel(agentCap.level);
    const requiredLevel = this.normalizeLevel(requiredCap.level);

    const agentLevelIdx = CAPABILITY_LEVELS.indexOf(agentLevel);
    const requiredLevelIdx = CAPABILITY_LEVELS.indexOf(requiredLevel);

    // Agent meets or exceeds required level
    if (agentLevelIdx >= requiredLevelIdx) {
      return 1.0 + (agentLevelIdx - requiredLevelIdx) * 0.1;
    }

    // Agent is below required level - apply penalty
    const gap = requiredLevelIdx - agentLevelIdx;
    return Math.max(0.3, 1.0 - gap * 0.25);
  }

  /**
   * Normalize undefined/mixed-case levels
   */
  private normalizeLevel(level?: string): CapabilityLevel {
    if (!level) return "intermediate";
    const cleanLevel = level.toLowerCase() as CapabilityLevel;
    return CAPABILITY_LEVELS.includes(cleanLevel) ? cleanLevel : "intermediate";
  }

  /**
   * Convert capability to text for embedding
   */
  private capabilityToText(cap: AgentCapability): string {
    return `${cap.name}: ${cap.description}`.toLowerCase();
  }

  /**
   * Calculate cosine similarity between vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] ** 2;
      magnitudeB += vecB[i] ** 2;
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    return magnitudeA && magnitudeB
      ? dotProduct / (magnitudeA * magnitudeB)
      : 0;
  }

  private notifySubscribers(agent: Agent): void {
    // In real implementation: Webhooks, message queue, etc.
    console.log(`New agent registered: ${agent.name}`);
  }
  /**
   * Verify agent status
   */
  async verifyAgentStatus(agent: Agent): Promise<Agent["status"]> {
    return agent.status ? "available" : "offline";
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(
    agentId: string,
    status: Agent["status"]
  ): Promise<void> {
    const agent = await this.getAgentDetails(agentId, false);
    if (!agent) return;

    agent.status = status;
    this.agents.set(agentId, agent);
  }
}

import { AgentSuggestion } from "../../types/agent";
export class AgentSuggestionService {
  /**
   * Get agent suggestions based on task requirements
   */
  async getAgentSuggestions(
    taskDescription: string,
    requiredCapabilities: string[]
  ): Promise<AgentSuggestion[]> {
    // In real implementation, this would use:
    // - Machine learning models
    // - Predefined templates
    // - Historical data

    // Mock implementation with predefined templates
    return [
      <AgentSuggestion>{
        id: "template-research",
        name: "Research Specialist",
        description: "Agent specialized in web research tasks",
        capabilities: [
          { name: "web_search", description: "Perform web searches" },
          { name: "summarization", description: "Summarize content" },
        ],
        creationComplexity: "low",
        estimatedSetupTime: 30,
      },
      <AgentSuggestion>{
        id: "template-coding",
        name: "Code Generator",
        description: "Creates code based on requirements",
        capabilities: [
          { name: "code_generation", description: "Generate source code" },
          { name: "debugging", description: "Debug existing code" },
        ],
        creationComplexity: "medium",
        estimatedSetupTime: 60,
      },
      <AgentSuggestion>{
        id: "template-writing",
        name: "Content Writer",
        description: "Creates written content",
        capabilities: [
          {
            name: "content_creation",
            description: "Generate original content",
          },
          {
            name: "seo_optimization",
            description: "Optimize for search engines",
          },
        ],
        creationComplexity: "low",
        estimatedSetupTime: 45,
      },
    ].filter((template) =>
      requiredCapabilities.every((rc) =>
        template.capabilities.some((c) => c.name === rc)
      )
    );
  }

  /**
   * Detect required capabilities from task description
   */
  detectCapabilities(taskDescription: string): string[] {
    // Simple keyword-based detection
    const keywords = [
      { term: "research", capability: "web_search" },
      { term: "summarize", capability: "summarization" },
      { term: "write code", capability: "code_generation" },
      { term: "debug", capability: "debugging" },
      { term: "create content", capability: "content_creation" },
      { term: "analyze data", capability: "data_analysis" },
    ];

    const detected = keywords
      .filter((k) => taskDescription.toLowerCase().includes(k.term))
      .map((k) => k.capability);

    return [...new Set(detected)]; // Return unique capabilities
  }
}

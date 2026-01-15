export const agentSearchIndex = {
  name: "agentsIndex",
  type: "vectorSearch",
  definition: {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: 1536,
        similarity: "cosine",
        quantization: "none",
      },
      {
        type: "filter",
        path: "name",
      },
      {
        type: "filter",
        path: "description",
      },
      {
        type: "filter",
        path: "status",
      },
      {
        type: "filter",
        path: "capabilities.name",
      },
      {
        type: "filter",
        path: "capabilities.level",
      },
      {
        type: "filter",
        path: "capabilities.description",
      },
    ],
  },
};

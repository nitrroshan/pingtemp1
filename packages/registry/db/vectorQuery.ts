import mongoose from "mongoose";
import { Logger } from "tslog";

const logger = new Logger({ name: "agentRegistry/vectorQuery" });

interface VectorSearchStage {
  exact?: boolean;
  filter?: object;
  collectionName: string;
  path: string;
  queryVector: number[];
  limit?: number;
  index: string;
  numCandidates?: number;
}
interface ProjectStage {
  [key: string]: 1 | 0 | { $meta: string };
}

export interface SearchQuery {
  collectionName: string;
  fieldPath: string;
  queryVector: number[];
  limit?: number;
  indexName: string;
}
/**
 * Perform a vector k-NN query using Atlas Search ($vectorSearch) via the native MongoDB driver.
 *
 * Validates required fields, applies sensible defaults (exact: false, index: "agentsIndex", limit: 10, numCandidates auto-calculated),
 * and executes an aggregation pipeline with $vectorSearch followed by $project.
 *
 * @param searchStage - VectorSearchStage object with:
 *   - collectionName (required): target collection name
 *   - fieldPath (required): dotted path to the vector field (e.g. "plot_embedding_voyage_3_large")
 *   - queryVector (required): numeric array embedding
 *   - indexName (optional): Atlas Search index name; defaults to "agentsIndex"
 *   - limit (optional): number of neighbors to return; defaults to 10
 *   - numCandidates (optional): number of candidates for search; defaults to Math.max(100, limit * 10)
 *   - exact (optional): boolean for exact vs approximate search; defaults to false
 *   - filter (optional): MongoDB filter specification
 *   - explainOptions (optional): options for explaining the search
 * @param projectStage - Optional $project stage projection. If omitted, uses default projection
 * @returns Promise resolving to an array of BSON documents with vector search results and scores.
 * @throws Error if DB connection is not established or required searchStage fields are missing/invalid.
 */
export default async function performVectorQuery(
  searchQuery: SearchQuery,
  requiredFields?: { [key: string]: 1 | 0 | { $meta: string } }
): Promise<mongoose.mongo.BSON.Document[]> {
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database connection is not established");
    }

    // Validate required inputs
    const {
      collectionName,
      fieldPath,
      queryVector,
      limit = 10,
      indexName = "agentsIndex",
    } = searchQuery || ({} as SearchQuery);

    // Build a default vectorSearch stage, merging any provided fields
    const vectorSearchStage: VectorSearchStage = {
      collectionName: collectionName,
      exact: true,
      index: indexName,
      limit,
      path: fieldPath,
      queryVector,
      filter: {},
    };
    let projectStage: ProjectStage = {};
    if (requiredFields)
      for (const key in requiredFields) {
        projectStage[key] = requiredFields[key]!;
      }
    if (Object.keys(projectStage).length === 0) {
      projectStage = {
        _id: 1,
        score: { $meta: "vectorSearchScore" },
      };
    }

    const collection = db.collection(collectionName);

    const pipeline = [
      {
        $vectorSearch: vectorSearchStage,
      },
      {
        $project: projectStage,
      },
    ];

    const cursor = collection.aggregate(pipeline);
    const results = await cursor.toArray();

    logger.info(`Vector query returned ${results.length} documents`);
    return results;
  } catch (err) {
    logger.error("Vector query error:", err);
    throw err;
  }
}

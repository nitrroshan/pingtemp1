https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-type/?interface-avs=atlas-ui#std-label-avs-types-vector-search
Model.createSearchIndex()
Model.createSearchIndexes()

## Update this documentation
## MongoDB Aggregation
# Aggregation Pipeline
An aggregation pipeline consists of one or more stages that process documents. These documents can come from a collection, a view, or a specially designed stage.

# Aggregation stages
Aggregation pipelines are made of array of stages. Each document pass through each stage in sequence.

## Aggregation stages — quick reference
For full details see: https://www.mongodb.com/docs/manual/reference/mql/aggregation-stages/#db.collection.aggregate---stages

Common stages (one-line descriptions):
- [$vectorSearch](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/#mongodb-pipeline-pipe.-vectorSearch)- The $vectorSearch stage performs an ANN or ENN search on a vector in the specified field.
syntax:
{
  "$vectorSearch": {
    "exact": true | false,
    "filter": {<filter-specification>},
    "index": "<index-name>",
    "limit": <number-of-results>,
    "numCandidates": <number-of-candidates>,
    "path": "<field-to-search>",
    "queryVector": [<array-of-numbers>],
    "explainOptions": {
      "traceDocumentIds": [<array-of-documentIDs>]
    }
  }
}
- $project — Include, exclude or compute fields; reshape documents.

/**
 * https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/
 * $vectorSearch
 * A $vectorSearch pipeline has the following prototype form:
 *
 * {
 *   "$vectorSearch": {
 *     "exact": true | false,
 *     "filter": {<filter-specification>},
 *     "index": "<index-name>",
 *     "limit": <number-of-results>,
 *     "numCandidates": <number-of-candidates>,
 *     "path": "<field-to-search>",
 *     "queryVector": [<array-of-numbers>],
 *     "explainOptions": {
 *       "traceDocumentIds": [<array-of-documentIDs>]
 *     }
 *   }
 * }
 */



#!/usr/bin/env node
/**
 * Seed Official Skills
 *
 * Creates 10 official Ping skills with vector embeddings.
 * Run: npm run seed:skills
 */

import dotenv from "dotenv";
import { rootLogger } from "../../logging/index.js";
import connectDB, { disconnectDB } from "../../db/config.js";
import { SkillModel } from "../schema/skillSchema.js";
import { generateEmbedding } from "../services/EmbeddingService.js";
import type { Skill } from "../types/Skill.js";

dotenv.config();
const logger = rootLogger.child({ module: "seed:skills" });

/**
 * 10 Official Skills
 *
 * Each skill represents "packaged expertise" - not just tool wrappers.
 * Descriptions are optimized for semantic search (what + when to use).
 */
const OFFICIAL_SKILLS: Omit<
  Skill,
  "_id" | "embedding" | "createdAt" | "updatedAt"
>[] = [
  {
    skillId: "security-review",
    name: "Security Review",
    description:
      "Reviews code for security vulnerabilities using OWASP rules. " +
      "Use when reviewing code for security issues, scanning for vulnerabilities, " +
      "checking authentication/authorization, or when user mentions security, pen testing, or CVEs.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/security-review/",
    skillMdPath: "~/.ping/skills/security-review/SKILL.md",
    supportingFiles: [
      "owasp-rules.md",
      "scripts/run_semgrep.py",
      "config/semgrep.yaml",
    ],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.9,
    tags: ["security", "owasp", "vulnerability", "scanning", "code-review"],
  },
  {
    skillId: "code-review",
    name: "Code Review",
    description:
      "Reviews code for best practices, maintainability, and team standards. " +
      "Use when reviewing pull requests, checking code quality, enforcing style guides, " +
      "or when user mentions code review, PR review, or code quality.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/code-review/",
    skillMdPath: "~/.ping/skills/code-review/SKILL.md",
    supportingFiles: [
      "best-practices/python.md",
      "best-practices/javascript.md",
      "best-practices/typescript.md",
      "scripts/run_linters.py",
    ],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.8,
    tags: ["code-review", "best-practices", "linting", "style", "quality"],
  },
  {
    skillId: "performance-analysis",
    name: "Performance Analysis",
    description:
      "Analyzes code and system performance, identifies bottlenecks. " +
      "Use when profiling code, optimizing slow functions, checking memory usage, " +
      "or when user mentions performance, slow, optimization, or bottlenecks.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/performance-analysis/",
    skillMdPath: "~/.ping/skills/performance-analysis/SKILL.md",
    supportingFiles: ["profiling-tools.md", "scripts/run_profiler.py"],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.7,
    tags: ["performance", "profiling", "optimization", "bottleneck"],
  },
  {
    skillId: "api-testing",
    name: "API Testing",
    description:
      "Tests REST and GraphQL APIs with comprehensive test scenarios. " +
      "Use when testing endpoints, validating API responses, checking status codes, " +
      "or when user mentions API testing, integration tests, or endpoints.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/api-testing/",
    skillMdPath: "~/.ping/skills/api-testing/SKILL.md",
    supportingFiles: ["test-scenarios.md", "scripts/run_api_tests.py"],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.6,
    tags: ["api", "testing", "rest", "graphql", "integration-tests"],
  },
  {
    skillId: "database-migration",
    name: "Database Migration",
    description:
      "Manages database schema changes and data migrations safely. " +
      "Use when creating migrations, altering schemas, migrating data between versions, " +
      "or when user mentions database migration, schema change, or data migration.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/database-migration/",
    skillMdPath: "~/.ping/skills/database-migration/SKILL.md",
    supportingFiles: ["migration-patterns.md", "scripts/generate_migration.py"],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.5,
    tags: ["database", "migration", "schema", "sql", "data"],
  },
  {
    skillId: "documentation-writer",
    name: "Documentation Writer",
    description:
      "Writes clear, comprehensive technical documentation. " +
      "Use when creating README files, API docs, user guides, architecture docs, " +
      "or when user mentions documentation, docs, or technical writing.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/documentation-writer/",
    skillMdPath: "~/.ping/skills/documentation-writer/SKILL.md",
    supportingFiles: [
      "templates/README.md",
      "templates/API.md",
      "style-guide.md",
    ],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.8,
    tags: ["documentation", "technical-writing", "readme", "api-docs"],
  },
  {
    skillId: "ci-cd-setup",
    name: "CI/CD Pipeline Setup",
    description:
      "Sets up continuous integration and deployment pipelines. " +
      "Use when configuring GitHub Actions, GitLab CI, Jenkins, or deployment workflows, " +
      "or when user mentions CI/CD, pipelines, automation, or deployment.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/ci-cd-setup/",
    skillMdPath: "~/.ping/skills/ci-cd-setup/SKILL.md",
    supportingFiles: [
      "templates/github-actions.yml",
      "templates/gitlab-ci.yml",
      "deployment-strategies.md",
    ],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.7,
    tags: ["ci-cd", "devops", "automation", "deployment", "pipelines"],
  },
  {
    skillId: "ui-component-builder",
    name: "UI Component Builder",
    description:
      "Builds reusable UI components following design systems. " +
      "Use when creating React/Vue components, implementing design specs, building component libraries, " +
      "or when user mentions UI components, design system, or component library.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/ui-component-builder/",
    skillMdPath: "~/.ping/skills/ui-component-builder/SKILL.md",
    supportingFiles: [
      "design-patterns.md",
      "templates/react-component.tsx",
      "accessibility-checklist.md",
    ],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.6,
    tags: ["ui", "react", "vue", "components", "design-system"],
  },
  {
    skillId: "unit-test-writer",
    name: "Unit Test Writer",
    description:
      "Writes comprehensive unit tests with high coverage. " +
      "Use when creating test suites, testing functions/classes, mocking dependencies, " +
      "or when user mentions unit tests, test coverage, or TDD.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/unit-test-writer/",
    skillMdPath: "~/.ping/skills/unit-test-writer/SKILL.md",
    supportingFiles: [
      "test-patterns.md",
      "templates/jest-test.ts",
      "templates/pytest-test.py",
      "mocking-guide.md",
    ],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.7,
    tags: ["testing", "unit-tests", "tdd", "jest", "pytest"],
  },
  {
    skillId: "error-debugger",
    name: "Error Debugger",
    description:
      "Debugs errors systematically using stack traces and logs. " +
      "Use when investigating bugs, analyzing stack traces, finding root causes, " +
      "or when user mentions debugging, error, exception, or bug.",
    version: "1.0.0",
    skillPath: "~/.ping/skills/error-debugger/",
    skillMdPath: "~/.ping/skills/error-debugger/SKILL.md",
    supportingFiles: ["debugging-strategies.md", "common-errors.md"],
    author: "ping-official",
    source: "registry",
    installCount: 0,
    rating: 4.8,
    tags: ["debugging", "errors", "troubleshooting", "root-cause"],
  },
];

/**
 * Seed skills with vector embeddings
 */
async function seedSkills() {
  logger.info("Starting skill seeding...");

  try {
    // Connect to database
    await connectDB();

    // Check if skills already exist
    const existingCount = await SkillModel.countDocuments();
    if (existingCount > 0) {
      logger.warn(
        `Database already contains ${existingCount} skills. Clearing...`
      );
      await SkillModel.deleteMany({});
      logger.info("Existing skills cleared");
    }

    // Generate embeddings in batch (reduce API calls)
    logger.info("Generating embeddings for 10 skills...");
    const descriptions = OFFICIAL_SKILLS.map((s) => s.description);
    const embeddings = await generateEmbeddings(descriptions);

    // Create skills with embeddings
    const skillsWithEmbeddings = OFFICIAL_SKILLS.map((skill, i) => ({
      ...skill,
      embedding: embeddings[i],
    }));

    logger.info("Inserting skills into database...");
    const inserted = await SkillModel.insertMany(skillsWithEmbeddings);
    logger.info(`Successfully seeded ${inserted.length} official skills`);

    // Verify vector search index exists (Atlas only)
    logger.info(
      "\nNOTE: Vector search requires MongoDB Atlas with index created:"
    );
    logger.info("  db.skills.createSearchIndex({");
    logger.info('    name: "skill_vector_search",');
    logger.info('    type: "vectorSearch",');
    logger.info("    definition: {");
    logger.info("      fields: [{");
    logger.info('        type: "vector",');
    logger.info('        path: "embedding",');
    logger.info("        numDimensions: 1536,");
    logger.info('        similarity: "cosine"');
    logger.info("      }]");
    logger.info("    }");
    logger.info("  })");

    // Summary
    logger.info("\n✅ Seeding complete!");
    logger.info("Skills by primary tag:");
    const byTag = inserted.reduce((acc, skill) => {
      const primaryTag = skill.tags[0] || "untagged"; // First tag as primary
      acc[primaryTag] = (acc[primaryTag] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    Object.entries(byTag).forEach(([tag, count]) => {
      logger.info(`  ${tag}: ${count}`);
    });
  } catch (error) {
    logger.error("Seeding failed:", error);
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

/**
 * Generate embeddings in batch (more efficient)
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  // TODO: Implement batch embedding generation
  // For now, generate one by one (replace with batch API call)
  const embeddings: number[][] = [];

  for (const text of texts) {
    try {
      const embedding = await generateEmbedding(text);
      embeddings.push(embedding);
      logger.info(`  Generated embedding for: ${text.substring(0, 50)}...`);
    } catch (error) {
      logger.error(
        `Failed to generate embedding for: ${text.substring(0, 50)}...`,
        error
      );
      throw error;
    }
  }

  return embeddings;
}

// Run seeding
seedSkills();

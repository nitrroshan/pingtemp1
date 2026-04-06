/**
 * AgentLoader - Loads agent definitions from YAML files
 *
 * Scans the agents/ directory and parses YAML definitions.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, extname } from "path";
import * as yaml from "yaml";
import type { AgentDefinition } from "./types.js";

export class AgentLoader {
  private agentsDir: string;
  private cache: Map<string, AgentDefinition> = new Map();

  constructor(agentsDir: string) {
    this.agentsDir = agentsDir;
  }

  /**
   * Load all agent definitions from the agents directory
   */
  loadAll(): AgentDefinition[] {
    if (!existsSync(this.agentsDir)) {
      console.warn(`Agents directory not found: ${this.agentsDir}`);
      return [];
    }

    const definitions: AgentDefinition[] = [];
    const files = readdirSync(this.agentsDir);

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (ext === ".yaml" || ext === ".yml") {
        try {
          const definition = this.loadFile(join(this.agentsDir, file));
          definitions.push(definition);
          this.cache.set(definition.id, definition);
        } catch (error) {
          console.error(`Failed to load agent definition: ${file}`, error);
        }
      }
    }

    return definitions;
  }

  /**
   * Load a specific agent definition by ID
   */
  load(agentId: string): AgentDefinition | undefined {
    // Check cache first
    if (this.cache.has(agentId)) {
      return this.cache.get(agentId);
    }

    // Try to find the file
    const possibleFiles = [`${agentId}.yaml`, `${agentId}.yml`];

    for (const file of possibleFiles) {
      const filePath = join(this.agentsDir, file);
      if (existsSync(filePath)) {
        const definition = this.loadFile(filePath);
        this.cache.set(definition.id, definition);
        return definition;
      }
    }

    return undefined;
  }

  /**
   * Load a YAML file and parse it as AgentDefinition
   */
  private loadFile(filePath: string): AgentDefinition {
    const content = readFileSync(filePath, "utf-8");
    const parsed = yaml.parse(content);

    // Validate required fields
    this.validate(parsed, filePath);

    return parsed as AgentDefinition;
  }

  /**
   * Validate that the parsed YAML has required fields
   */
  private validate(parsed: any, filePath: string): void {
    const required = ["id", "name", "type", "role", "goal", "config"];
    const missing = required.filter((field) => !parsed[field]);

    if (missing.length > 0) {
      throw new Error(
        `Invalid agent definition in ${filePath}: missing required fields: ${missing.join(", ")}`,
      );
    }

    // Validate type
    const validTypes = ["internal", "external", "agentic-ui", "builder"];
    if (!validTypes.includes(parsed.type)) {
      throw new Error(
        `Invalid agent type "${parsed.type}" in ${filePath}. Must be one of: ${validTypes.join(", ")}`,
      );
    }
  }

  /**
   * Reload all definitions (clears cache)
   */
  reload(): AgentDefinition[] {
    this.cache.clear();
    return this.loadAll();
  }

  /**
   * Get a cached definition
   */
  get(agentId: string): AgentDefinition | undefined {
    return this.cache.get(agentId);
  }

  /**
   * List all cached agent IDs
   */
  listIds(): string[] {
    return Array.from(this.cache.keys());
  }
}

/**
 * PromptBuilder — Generic XML prompt assembler
 *
 * Responsibility: Build system prompts from modular XML sections.
 * Does NOT know about agents, workers, planners, or tools.
 * Pure data structure → string conversion.
 *
 * Each section type maps to an XML tag:
 *   identity    → <agent-identity>
 *   capability  → <capabilities><name>...</name></capabilities>
 *   behavior    → <behaviors><name>...</name></behaviors>
 *   rule        → <rules><name>...</name></rules>
 *   section     → <tag>...</tag>  (arbitrary)
 */

export interface PromptSection {
  tag: string;
  content: string;
}

export class PromptBuilder {
  private _identity: string = "";
  private _capabilities: PromptSection[] = [];
  private _behaviors: PromptSection[] = [];
  private _rules: PromptSection[] = [];
  private _outputFormats: PromptSection[] = [];
  private _sections: PromptSection[] = [];

  identity(text: string): this {
    this._identity = text;
    return this;
  }

  capability(name: string, description: string, tools?: string[]): this {
    const toolLine = tools?.length
      ? `\n\nTools: ${tools.map((t) => `\`${t}\``).join(", ")}`
      : "";
    this._capabilities.push({ tag: name, content: `${description}${toolLine}` });
    return this;
  }

  behavior(name: string, description: string): this {
    this._behaviors.push({ tag: name, content: description });
    return this;
  }

  rule(name: string, description: string): this {
    this._rules.push({ tag: name, content: description });
    return this;
  }

  /** Add an output format example (what shape your response/tool call should take). */
  outputFormat(name: string, description: string): this {
    this._outputFormats.push({ tag: name, content: description });
    return this;
  }

  section(tag: string, content: string): this {
    this._sections.push({ tag, content });
    return this;
  }

  build(): string {
    const parts: string[] = [];

    if (this._identity) {
      parts.push(wrap("agent-identity", this._identity));
    }

    if (this._capabilities.length > 0) {
      parts.push(wrapGroup("capabilities", this._capabilities));
    }

    if (this._behaviors.length > 0) {
      parts.push(wrapGroup("behaviors", this._behaviors));
    }

    if (this._rules.length > 0) {
      parts.push(wrapGroup("rules", this._rules));
    }

    if (this._outputFormats.length > 0) {
      parts.push(wrapGroup("output-formats", this._outputFormats));
    }

    for (const s of this._sections) {
      parts.push(wrap(s.tag, s.content));
    }

    return parts.join("\n\n");
  }
}

function wrap(tag: string, content: string): string {
  return `<${tag}>\n${content}\n</${tag}>`;
}

function wrapGroup(groupTag: string, items: PromptSection[]): string {
  const inner = items.map((i) => wrap(i.tag, i.content)).join("\n\n");
  return `<${groupTag}>\n\n${inner}\n\n</${groupTag}>`;
}

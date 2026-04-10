export interface Skill {
  id: string;
  skillId: string;
  name: string;
  description: string;
  version: string;
  skillPath: string;
  skillMdPath?: string;
  supportingFiles?: string[];
  author: string;
  source: string;
  sourceUrl?: string;
  installCount: number;
  rating: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

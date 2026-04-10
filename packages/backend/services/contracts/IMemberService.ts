import type { TeamMember } from "../types/index.js";

export interface IMemberService {
  addMember(teamId: string, userId: string, role: "manager" | "employee"): Promise<TeamMember>;
  removeMember(teamId: string, userId: string): Promise<void>;
  getTeamMembers(teamId: string): Promise<TeamMember[]>;
}

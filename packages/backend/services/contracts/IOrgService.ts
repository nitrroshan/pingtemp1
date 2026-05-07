export interface OrgSummary {
  id: string;
  name: string;
  plan: string;
  createdAt: string;
  memberCount: number;
  role: string; // caller's role in this org
}

export interface OrgDetail extends OrgSummary {
  members: OrgMember[];
}

export interface OrgMember {
  userId: string;
  role: string;
  joinedAt: string;
}

export interface IOrgService {
  /** Create a new organization. Caller becomes owner. */
  create(name: string, ownerId: string, plan?: string): Promise<OrgSummary>;
  /** List orgs the user belongs to */
  listForUser(userId: string): Promise<OrgSummary[]>;
  /** Get org detail with member list. Returns null if org doesn't exist. */
  getById(orgId: string, callerId: string): Promise<OrgDetail | null>;
  /** Update org name or plan. Only owner/admin. callerId is used for accurate role in response. */
  update(orgId: string, fields: { name?: string; plan?: string }, callerId?: string): Promise<OrgSummary | null>;
  /** Delete org. Cascades to agent_teams → goals → tasks. */
  delete(orgId: string): Promise<boolean>;
  /** Add or update a member's role */
  addMember(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void>;
  /** Remove a member */
  removeMember(orgId: string, userId: string): Promise<void>;
  /** Update a member's role */
  updateMemberRole(orgId: string, userId: string, role: "admin" | "member" | "viewer"): Promise<void>;
  /** Get the caller's role in an org. Returns null if not a member. */
  getUserRole(orgId: string, userId: string): Promise<string | null>;
}

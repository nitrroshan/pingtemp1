export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: "manager" | "employee";
  joinedAt: string;
}

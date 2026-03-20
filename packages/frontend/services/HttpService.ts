/**
 * HttpService - Handles HTTP API calls to backend
 */

export class HttpService {
  constructor(private httpUrl: string = "http://localhost:3002") {}

  /**
   * Create a new team via HTTP API
   */
  async createTeam(teamParams: {
    teamName: string;
    goal: string;
    description?: string;
  }): Promise<any> {
    const url = `${this.httpUrl}/api/createnewteam`;
    console.log("[HttpService] Creating team:", teamParams);
    console.log("[HttpService] Request URL:", url);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(teamParams),
    });

    console.log("[HttpService] Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[HttpService] Error response:", errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("[HttpService] Team created:", data);
    return data;
  }

  /**
   * Get all tasks
   */
  async getTasks(): Promise<any[]> {
    console.log("[HttpService] Fetching tasks...");

    const response = await fetch(`${this.httpUrl}/api/tasks`);
    const data = await response.json();

    console.log(`[HttpService] Fetched ${data.tasks?.length || 0} tasks`);
    return data.tasks || [];
  }

  /**
   * Get roles from database by team ID
   */
  async getRolesByTeam(teamId: string): Promise<any[]> {
    console.log("[HttpService] Fetching roles for team:", teamId);

    const url = new URL(`${this.httpUrl}/api/roles`);
    url.searchParams.set("teamId", teamId);

    const response = await fetch(url.toString());
    const data = await response.json();

    console.log(`[HttpService] Fetched ${data.roles?.length || 0} roles`);
    return data.roles || [];
  }

  /**
   * Discover roles dynamically by task description
   */
  async getRolesByTask(taskDescription?: string): Promise<any[]> {
    console.log("[HttpService] Discovering roles for task:", taskDescription);

    const url = new URL(`${this.httpUrl}/api/roles`);
    if (taskDescription) {
      url.searchParams.set("task", taskDescription);
    }

    const response = await fetch(url.toString());
    const data = await response.json();

    console.log(`[HttpService] Discovered ${data.roles?.length || 0} roles`);
    return data.roles || [];
  }

  /**
   * Get all teams
   */
  async getTeams(): Promise<any[]> {
    console.log("[HttpService] Fetching teams...");

    const response = await fetch(`${this.httpUrl}/api/teams`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    console.log(`[HttpService] Fetched ${data.teams?.length || 0} teams`);
    return data.teams || [];
  }

  /**
   * Get team by ID
   */
  async getTeam(teamId: string): Promise<any> {
    console.log("[HttpService] Fetching team:", teamId);

    const response = await fetch(`${this.httpUrl}/api/teams/${teamId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    console.log("[HttpService] Team fetched:", data.team);
    return data.team;
  }

  /**
   * Generic GET request
   */
  async get(endpoint: string): Promise<any> {
    console.log(`[HttpService] GET ${endpoint}`);

    const response = await fetch(`${this.httpUrl}${endpoint}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generic POST request
   */
  async post(endpoint: string, body: any): Promise<any> {
    console.log(`[HttpService] POST ${endpoint}`, body);

    const response = await fetch(`${this.httpUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}

// Singleton instance
export const httpService = new HttpService();

/**
 * Team Service Errors
 * 
 * Custom error types for team management operations.
 */

export class TeamServiceError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'TeamServiceError'
  }
}

// Team errors
export class TeamNotFoundError extends TeamServiceError {
  constructor(teamId: string) {
    super(`Team not found: ${teamId}`, 'TEAM_NOT_FOUND')
    this.name = 'TeamNotFoundError'
  }
}

export class TeamNameRequiredError extends TeamServiceError {
  constructor() {
    super('Team name is required', 'TEAM_NAME_REQUIRED')
    this.name = 'TeamNameRequiredError'
  }
}

// Agent errors
export class AgentNotFoundError extends TeamServiceError {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND')
    this.name = 'AgentNotFoundError'
  }
}

export class CannotAddSecondPlannerError extends TeamServiceError {
  constructor(teamId: string) {
    super(`Team ${teamId} already has a Planner Agent`, 'CANNOT_ADD_SECOND_PLANNER')
    this.name = 'CannotAddSecondPlannerError'
  }
}

export class CannotDelegatePlannerError extends TeamServiceError {
  constructor(agentId: string) {
    super(`Cannot delegate Planner Agent: ${agentId}`, 'CANNOT_DELEGATE_PLANNER')
    this.name = 'CannotDelegatePlannerError'
  }
}

export class CannotRemovePlannerError extends TeamServiceError {
  constructor(agentId: string) {
    super(`Cannot remove Planner Agent: ${agentId}`, 'CANNOT_REMOVE_PLANNER')
    this.name = 'CannotRemovePlannerError'
  }
}

export class AgentAlreadyDelegatedError extends TeamServiceError {
  constructor(agentId: string, currentDelegateId: string) {
    super(`Agent ${agentId} is already delegated to ${currentDelegateId}`, 'AGENT_ALREADY_DELEGATED')
    this.name = 'AgentAlreadyDelegatedError'
  }
}

export class AgentNotDelegatedError extends TeamServiceError {
  constructor(agentId: string) {
    super(`Agent ${agentId} is not delegated`, 'AGENT_NOT_DELEGATED')
    this.name = 'AgentNotDelegatedError'
  }
}

// Member errors
export class NotTeamManagerError extends TeamServiceError {
  constructor(userId: string, teamId: string) {
    super(`User ${userId} is not the manager of team ${teamId}`, 'NOT_TEAM_MANAGER')
    this.name = 'NotTeamManagerError'
  }
}

export class MemberNotFoundError extends TeamServiceError {
  constructor(userId: string, teamId: string) {
    super(`User ${userId} is not a member of team ${teamId}`, 'MEMBER_NOT_FOUND')
    this.name = 'MemberNotFoundError'
  }
}

export class MemberAlreadyExistsError extends TeamServiceError {
  constructor(userId: string, teamId: string) {
    super(`User ${userId} is already a member of team ${teamId}`, 'MEMBER_ALREADY_EXISTS')
    this.name = 'MemberAlreadyExistsError'
  }
}

export class CannotRemoveManagerError extends TeamServiceError {
  constructor(userId: string, teamId: string) {
    super(`Cannot remove manager ${userId} from team ${teamId}`, 'CANNOT_REMOVE_MANAGER')
    this.name = 'CannotRemoveManagerError'
  }
}

// Skill errors
export class SkillAlreadyAssignedError extends TeamServiceError {
  constructor(agentId: string, skillId: string) {
    super(`Skill ${skillId} is already assigned to agent ${agentId}`, 'SKILL_ALREADY_ASSIGNED')
    this.name = 'SkillAlreadyAssignedError'
  }
}

export class SkillNotAssignedError extends TeamServiceError {
  constructor(agentId: string, skillId: string) {
    super(`Skill ${skillId} is not assigned to agent ${agentId}`, 'SKILL_NOT_ASSIGNED')
    this.name = 'SkillNotAssignedError'
  }
}

export class ValidationError extends TeamServiceError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

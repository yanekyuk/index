/**
 * Central Scenario Definitions for Chat Agent Evaluation
 * 
 * This file contains all scenario specifications:
 * - User Needs: WHAT users want to accomplish
 * - User Personas: HOW users communicate
 * - User Contexts: User's state in the system
 */

// ═══════════════════════════════════════════════════════════════════════════════
// USER PERSONAS - Communication Styles
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * User communication styles and patterns
 */
export const USER_PERSONAS = {
  DIRECT_REQUESTER: {
    id: "direct_requester" as const,
    description: "Gets straight to the point",
    communicationStyle: "direct, brief, action-oriented",
    examples: [
      "Find ML engineers",
      "Show my profile",
      "Create intent: hiring React devs",
    ],
  },
  EXPLORATORY_SEEKER: {
    id: "exploratory_seeker" as const,
    description: "Explores options before deciding",
    communicationStyle: "curious, asks follow-up questions, explores options",
    examples: [
      "I'm looking for AI engineers... what do you have?",
      "Can you help me find co-founders?",
      "Show me what's available in my network",
    ],
  },
  TECHNICAL_PRECISE: {
    id: "technical_precise" as const,
    description: "Provides detailed specifications",
    communicationStyle: "precise, technical, detailed requirements",
    examples: [
      "Find senior ML engineers with 5+ years PyTorch experience",
      "Update my profile: add Rust, remove Java from skills",
      "Create index: Fintech Builders, invite-only, for Series A founders",
    ],
  },
  VAGUE_REQUESTER: {
    id: "vague_requester" as const,
    description: "Unclear or ambiguous requests",
    communicationStyle: "vague, ambiguous, needs clarification",
    examples: [
      "Find someone helpful",
      "Update my stuff",
      "Show me things",
    ],
  },
} as const;

export type UserPersona = typeof USER_PERSONAS[keyof typeof USER_PERSONAS];

// ═══════════════════════════════════════════════════════════════════════════════
// USER CONTEXTS - System State
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * User's state in the system (affects what they can do)
 */
export interface UserContext {
  hasProfile: boolean;
  hasIntents: boolean;
  isIndexOwner: boolean;
  indexMembershipCount: number;
}

export const USER_CONTEXTS = {
  NEW_USER: {
    hasProfile: false,
    hasIntents: false,
    isIndexOwner: false,
    indexMembershipCount: 0,
  },
  BASIC_MEMBER: {
    hasProfile: true,
    hasIntents: true,
    isIndexOwner: false,
    indexMembershipCount: 1,
  },
  ACTIVE_MEMBER: {
    hasProfile: true,
    hasIntents: true,
    isIndexOwner: false,
    indexMembershipCount: 3,
  },
  INDEX_OWNER: {
    hasProfile: true,
    hasIntents: true,
    isIndexOwner: true,
    indexMembershipCount: 2,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// USER NEEDS - Task Taxonomy
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Comprehensive User Needs Taxonomy for Full Chat Agent Evaluation
 * 
 * Covers all agent capabilities: Profile, Intents, Indexes, Opportunities, and Utilities
 */
export const CHAT_AGENT_USER_NEEDS = {
  // ═══════════════════════════════════════════════════════════════════════════════
  // PROFILE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════
  
  PROFILE_CREATE: {
    id: "profile_create" as const,
    description: "User wants to create their profile",
    examples: [
      "Create my profile",
      "Set up my profile with my LinkedIn",
      "I'm a software engineer interested in AI",
    ],
  },

  PROFILE_VIEW: {
    id: "profile_view" as const,
    description: "User wants to view their profile",
    examples: [
      "Show me my profile",
      "What's in my profile?",
      "View my information",
    ],
  },

  PROFILE_UPDATE: {
    id: "profile_update" as const,
    description: "User wants to update their profile",
    examples: [
      "Update my bio to include blockchain experience",
      "Add Python to my skills",
      "Change my location to Austin",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // INTENT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  INTENT_CREATE: {
    id: "intent_create" as const,
    description: "User wants to create a new intent/goal",
    examples: [
      "I'm looking for a technical co-founder",
      "Add an intent: hiring React developers",
      "I want to connect with fintech investors",
    ],
  },

  INTENT_VIEW: {
    id: "intent_view" as const,
    description: "User wants to see their intents",
    examples: [
      "Show me my intents",
      "What are my goals?",
      "List my active intents",
    ],
  },

  INTENT_UPDATE: {
    id: "intent_update" as const,
    description: "User wants to modify an existing intent",
    examples: [
      "Update my hiring intent to focus on senior engineers",
      "Change my co-founder intent",
      "Edit that intent to be more specific",
    ],
  },

  INTENT_DELETE: {
    id: "intent_delete" as const,
    description: "User wants to remove an intent",
    examples: [
      "Delete my hiring intent",
      "Remove that intent",
      "I don't need the co-founder goal anymore",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // INDEX (COMMUNITY) MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  INDEX_VIEW: {
    id: "index_view" as const,
    description: "User wants to see their indexes/communities",
    examples: [
      "Show me my communities",
      "What indexes am I in?",
      "List my groups",
    ],
  },

  INDEX_CREATE: {
    id: "index_create" as const,
    description: "User wants to create a new community",
    examples: [
      "Create an index for fintech builders",
      "Start a community for AI founders",
      "Make a new group for product managers",
    ],
  },

  INDEX_UPDATE: {
    id: "index_update" as const,
    description: "User wants to modify their community",
    examples: [
      "Update my index description",
      "Change the AI Founders index to be invite-only",
      "Edit the community title",
    ],
  },

  INDEX_MEMBERS: {
    id: "index_members" as const,
    description: "User wants to see who's in a community",
    examples: [
      "Who's in the AI Founders index?",
      "Show me members of my community",
      "List people in the fintech group",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // OPPORTUNITY DISCOVERY
  // ═══════════════════════════════════════════════════════════════════════════════

  OPPORTUNITY_FIND: {
    id: "opportunity_find" as const,
    description: "User wants to discover new connections/opportunities",
    examples: [
      "Find me AI/ML engineers",
      "Who can help with frontend development?",
      "Connect me to fintech investors",
    ],
  },

  OPPORTUNITY_LIST: {
    id: "opportunity_list" as const,
    description: "User wants to see their existing opportunities",
    examples: [
      "Show my opportunities",
      "Do I have any opportunities?",
      "List my suggested connections",
    ],
  },

  OPPORTUNITY_SEND: {
    id: "opportunity_send" as const,
    description: "User wants to send/activate an opportunity",
    examples: [
      "Send intro to Sarah",
      "Send that opportunity",
      "Connect me with Alice",
    ],
  },

  OPPORTUNITY_SCOPE: {
    id: "opportunity_scope" as const,
    description: "User wants to filter discovery by index/community",
    examples: [
      "Find mentors in the AI Founders index",
      "Search only in my React group",
      "Filter by Product Managers community",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // INTENT-INDEX LINKING
  // ═══════════════════════════════════════════════════════════════════════════════

  INTENT_INDEX_LINK: {
    id: "intent_index_link" as const,
    description: "User wants to add an intent to a community",
    examples: [
      "Add my hiring intent to the AI Founders index",
      "Link this intent to my community",
      "Put that goal in the fintech group",
    ],
  },

  INTENT_INDEX_VIEW: {
    id: "intent_index_view" as const,
    description: "User wants to see intents in a community",
    examples: [
      "Show intents in the AI Founders index",
      "What goals are in my community?",
      "List everyone's intents in this group",
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITIES & GENERAL
  // ═══════════════════════════════════════════════════════════════════════════════

  URL_SCRAPING: {
    id: "url_scraping" as const,
    description: "User wants to extract information from a URL",
    examples: [
      "Create my profile from linkedin.com/in/johndoe",
      "Turn this GitHub repo into an intent",
      "What's this article about? [URL]",
    ],
  },

  CLARIFICATION_NEEDED: {
    id: "clarification_needed" as const,
    description: "Agent needs more information to help",
    examples: [
      "Help me with my profile",
      "I need to find someone",
      "Update my stuff",
    ],
  },

  EDGE_CASE_HANDLING: {
    id: "edge_case_handling" as const,
    description: "Handle unusual requests or errors gracefully",
    examples: [
      "Delete all my intents",
      "Find me a unicorn startup founder in Antarctica",
      "Show me opportunities from 2 years ago",
    ],
  },
} as const;

export type UserNeed = (typeof CHAT_AGENT_USER_NEEDS)[keyof typeof CHAT_AGENT_USER_NEEDS];

// Convenience export for backward compatibility
export { CHAT_AGENT_USER_NEEDS as USER_NEEDS };

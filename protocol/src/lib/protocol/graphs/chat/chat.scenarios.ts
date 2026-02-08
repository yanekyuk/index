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
// USER NEEDS - Task Taxonomy
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Comprehensive User Needs Taxonomy for Chat Agent Evaluation
 * 
 * Based on actual chat agent tools and capabilities.
 * Each need maps to one or more tool calls the agent should make.
 * 
 * Each need includes pre-generated example messages for different personas.
 */
export const CHAT_AGENT_USER_NEEDS = {
  // ═══════════════════════════════════════════════════════════════════════════════
  // PROFILE MANAGEMENT (Tools: read_user_profiles, create_user_profile, update_user_profile)
  // ═══════════════════════════════════════════════════════════════════════════════
  
  PROFILE_CREATE: {
    id: "profile_create" as const,
    description: "User wants to create their profile",
    examples: [
      "Create my profile",
      "Set up my profile with my LinkedIn",
      "I'm a software engineer interested in AI",
    ],
    expectedTools: ["create_user_profile"],
    // Pre-generated messages by persona
    messages: {
      direct_requester: "Create my profile: software engineer, AI/ML, SF Bay Area",
      exploratory_seeker: "Hi! I'd like to set up my profile... how do I get started?",
      technical_precise: "Create profile with the following: Senior Software Engineer, 8 years experience, specialties in distributed systems and ML infrastructure, based in San Francisco",
      vague_requester: "I need a profile",
    },
  },

  PROFILE_VIEW: {
    id: "profile_view" as const,
    description: "User wants to view their profile",
    examples: [
      "Show me my profile",
      "What's in my profile?",
      "View my information",
    ],
    expectedTools: ["read_user_profiles"],
    messages: {
      direct_requester: "Show my profile",
      exploratory_seeker: "Can I see what's in my profile?",
      technical_precise: "Display my complete profile information including all fields",
      vague_requester: "What do I have?",
    },
  },

  PROFILE_UPDATE: {
    id: "profile_update" as const,
    description: "User wants to update their profile",
    examples: [
      "Update my bio to include blockchain experience",
      "Add Python to my skills",
      "Change my location to Austin",
    ],
    expectedTools: ["read_user_profiles", "update_user_profile", "confirm_action"],
    messages: {
      direct_requester: "Add Python and Rust to my skills",
      exploratory_seeker: "I'd like to update my profile with some new skills... can you help?",
      technical_precise: "Update profile: add Python, Rust, and Kubernetes to skills array; update location to Austin, TX",
      vague_requester: "Update my stuff",
    },
  },

  PROFILE_FROM_URL: {
    id: "profile_from_url" as const,
    description: "User wants to create/update profile from a URL (LinkedIn, GitHub, etc.)",
    examples: [
      "Create my profile from linkedin.com/in/johndoe",
      "Update my profile with this GitHub: github.com/user",
      "Import my profile from my LinkedIn",
    ],
    expectedTools: ["scrape_url", "create_user_profile"],
    messages: {
      direct_requester: "Create my profile from https://linkedin.com/in/johndoe",
      exploratory_seeker: "Can you import my profile from my LinkedIn at linkedin.com/in/johndoe?",
      technical_precise: "Extract profile data from https://linkedin.com/in/johndoe and create my profile with that information",
      vague_requester: "Use my LinkedIn",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // INTENT MANAGEMENT (Tools: read_intents, create_intent, update_intent, delete_intent)
  // ═══════════════════════════════════════════════════════════════════════════════

  INTENT_CREATE: {
    id: "intent_create" as const,
    description: "User wants to create a new intent/goal",
    examples: [
      "I'm looking for a technical co-founder",
      "Add an intent: hiring React developers",
      "I want to connect with fintech investors",
      "Create intent: Find AI ethics researchers",
    ],
    expectedTools: ["create_intent"],
    messages: {
      direct_requester: "Create intent: Find AI ethics researchers",
      exploratory_seeker: "I'm interested in finding AI ethics researchers... can you help me connect with some?",
      technical_precise: "Create a new intent: Looking for AI ethics researchers with academic background, focus on fairness and interpretability, preferably with publications in FAccT or similar venues",
      vague_requester: "I need to find some people",
    },
  },

  INTENT_VIEW: {
    id: "intent_view" as const,
    description: "User wants to see their intents",
    examples: [
      "Show me my intents",
      "What are my goals?",
      "List my active intents",
    ],
    expectedTools: ["read_intents"],
    messages: {
      direct_requester: "Show my intents",
      exploratory_seeker: "What goals do I have saved?",
      technical_precise: "List all my active intents with their IDs and descriptions",
      vague_requester: "What do I want?",
    },
  },

  INTENT_UPDATE: {
    id: "intent_update" as const,
    description: "User wants to modify an existing intent",
    examples: [
      "Update my hiring intent to focus on senior engineers",
      "Change my co-founder intent",
      "Edit that intent to be more specific",
    ],
    expectedTools: ["read_intents", "update_intent", "confirm_action"],
    messages: {
      direct_requester: "Update my hiring intent to focus on senior engineers only",
      exploratory_seeker: "Can I change that intent to be more specific?",
      technical_precise: "Update intent ID [from previous] to: Seeking senior full-stack engineers (5+ years) with React and Node.js expertise",
      vague_requester: "Change that thing",
    },
  },

  INTENT_DELETE: {
    id: "intent_delete" as const,
    description: "User wants to remove an intent",
    examples: [
      "Delete my hiring intent",
      "Remove that intent",
      "I don't need the co-founder goal anymore",
    ],
    expectedTools: ["read_intents", "delete_intent", "confirm_action"],
    messages: {
      direct_requester: "Delete my co-founder intent",
      exploratory_seeker: "I don't need that intent anymore... can you remove it?",
      technical_precise: "Archive/delete the intent with description 'Looking for technical co-founder'",
      vague_requester: "Get rid of that",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // INDEX (COMMUNITY) MANAGEMENT (Tools: read_indexes, create_index, update_index, delete_index)
  // ═══════════════════════════════════════════════════════════════════════════════

  INDEX_VIEW: {
    id: "index_view" as const,
    description: "User wants to see their indexes/communities",
    examples: [
      "Show me my communities",
      "What indexes am I in?",
      "List my groups",
    ],
    expectedTools: ["read_indexes"],
    messages: {
      direct_requester: "List my indexes",
      exploratory_seeker: "What communities am I part of?",
      technical_precise: "Display all indexes where I'm a member, including ownership status and member counts",
      vague_requester: "Show my groups",
    },
  },

  INDEX_CREATE: {
    id: "index_create" as const,
    description: "User wants to create a new community",
    examples: [
      "Create an index for fintech builders",
      "Start a community for AI founders",
      "Make a new group for product managers",
    ],
    expectedTools: ["create_index"],
    messages: {
      direct_requester: "Create index: AI Founders Network",
      exploratory_seeker: "I want to start a community for AI founders... how do I create one?",
      technical_precise: "Create a new index titled 'AI Founders Network' with description 'Community for AI/ML startup founders' and invite-only join policy",
      vague_requester: "Make a group",
    },
  },

  INDEX_UPDATE: {
    id: "index_update" as const,
    description: "User wants to modify their community settings",
    examples: [
      "Update my index description",
      "Change the AI Founders index to be invite-only",
      "Edit the community title",
    ],
    expectedTools: ["read_indexes", "update_index", "confirm_action"],
    messages: {
      direct_requester: "Make AI Founders index invite-only",
      exploratory_seeker: "Can I change my community settings to be more private?",
      technical_precise: "Update index settings: set joinPolicy to 'invite_only' for the AI Founders Network index",
      vague_requester: "Change the settings",
    },
  },

  INDEX_DELETE: {
    id: "index_delete" as const,
    description: "User wants to delete their community",
    examples: [
      "Delete my test index",
      "Remove the Product Managers community",
      "Get rid of that empty index",
    ],
    expectedTools: ["read_indexes", "delete_index", "confirm_action"],
    messages: {
      direct_requester: "Delete my Test Community index",
      exploratory_seeker: "I don't need that community anymore... can you delete it?",
      technical_precise: "Remove/delete the index titled 'Test Community' that I own",
      vague_requester: "Delete that",
    },
  },

  INDEX_MEMBERS_VIEW: {
    id: "index_members_view" as const,
    description: "User wants to see who's in a community",
    examples: [
      "Who's in the AI Founders index?",
      "Show me members of my community",
      "List people in the fintech group",
    ],
    expectedTools: ["read_indexes", "read_users"],
    messages: {
      direct_requester: "Show members in AI Founders",
      exploratory_seeker: "Who's in my community?",
      technical_precise: "List all members of the AI Founders Network index with their join dates and intent counts",
      vague_requester: "Who's in there?",
    },
  },

  INDEX_MEMBER_ADD: {
    id: "index_member_add" as const,
    description: "User wants to add someone to their community",
    examples: [
      "Add Sarah to my fintech community",
      "Invite John to the AI Founders index",
      "Add this person to my group",
    ],
    expectedTools: ["read_indexes", "read_users", "create_index_membership"],
    messages: {
      direct_requester: "Add user Sarah Chen to AI Founders index",
      exploratory_seeker: "Can I invite someone to join my community?",
      technical_precise: "Add user ID [from context] as a member to the AI Founders Network index",
      vague_requester: "Add them",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // INTENT-INDEX LINKING (Tools: create_intent_index, read_intent_indexes, delete_intent_index)
  // ═══════════════════════════════════════════════════════════════════════════════

  INTENT_INDEX_LINK: {
    id: "intent_index_link" as const,
    description: "User wants to add one of their intents to a specific community",
    examples: [
      "Add my hiring intent to the AI Founders index",
      "Link this intent to my community",
      "Put my co-founder goal in the fintech group",
    ],
    expectedTools: ["read_intents", "read_indexes", "create_intent_index"],
    messages: {
      direct_requester: "Add my hiring intent to AI Founders",
      exploratory_seeker: "Can I add my intent to the AI Founders community?",
      technical_precise: "Link intent ID [from context] to index ID [from context] via intent_indexes",
      vague_requester: "Put it in there",
    },
  },

  INTENT_INDEX_VIEW: {
    id: "intent_index_view" as const,
    description: "User wants to see all intents in a community (not just their own)",
    examples: [
      "Show all intents in the AI Founders index",
      "What goals are in my community?",
      "List everyone's intents in this group",
    ],
    expectedTools: ["read_indexes", "read_intents"],
    messages: {
      direct_requester: "Show all intents in AI Founders",
      exploratory_seeker: "What is everyone looking for in our community?",
      technical_precise: "List all intents associated with the AI Founders Network index, including creator IDs",
      vague_requester: "What's in there?",
    },
  },

  INTENT_INDEX_UNLINK: {
    id: "intent_index_unlink" as const,
    description: "User wants to remove their intent from a community",
    examples: [
      "Remove my hiring intent from this index",
      "Take my goal out of the fintech group",
      "Unlink this intent from the community",
    ],
    expectedTools: ["read_intents", "read_indexes", "delete_intent_index"],
    messages: {
      direct_requester: "Remove my hiring intent from AI Founders",
      exploratory_seeker: "Can I take that intent out of the community?",
      technical_precise: "Delete the intent_indexes link between intent ID [from context] and index ID [from context]",
      vague_requester: "Take it out",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // OPPORTUNITY DISCOVERY (Tools: create_opportunities, list_my_opportunities, send_opportunity)
  // ═══════════════════════════════════════════════════════════════════════════════

  OPPORTUNITY_FIND: {
    id: "opportunity_find" as const,
    description: "User wants to discover new connections/opportunities based on their intents or a query",
    examples: [
      "Find me AI/ML engineers",
      "Who can help with frontend development?",
      "Connect me to fintech investors",
      "Who should I meet?",
    ],
    expectedTools: ["create_opportunities"],
    messages: {
      direct_requester: "Find AI/ML engineers",
      exploratory_seeker: "Who should I connect with in the network?",
      technical_precise: "Search for AI/ML engineers with 5+ years experience, focus on deep learning and NLP",
      vague_requester: "Find someone",
    },
  },

  OPPORTUNITY_LIST: {
    id: "opportunity_list" as const,
    description: "User wants to see their existing opportunities",
    examples: [
      "Show my opportunities",
      "Do I have any opportunities?",
      "List my suggested connections",
    ],
    expectedTools: ["list_my_opportunities"],
    messages: {
      direct_requester: "Show my opportunities",
      exploratory_seeker: "What connections have been suggested for me?",
      technical_precise: "List all my opportunities with status, confidence scores, and suggested connections",
      vague_requester: "What do I have?",
    },
  },

  OPPORTUNITY_SEND: {
    id: "opportunity_send" as const,
    description: "User wants to send/activate a draft opportunity",
    examples: [
      "Send intro to Sarah",
      "Send that opportunity",
      "Connect me with the first person",
    ],
    expectedTools: ["list_my_opportunities", "send_opportunity"],
    messages: {
      direct_requester: "Send the first opportunity",
      exploratory_seeker: "Can you send an intro to that person?",
      technical_precise: "Activate and send notification for opportunity ID [from context]",
      vague_requester: "Send it",
    },
  },

  OPPORTUNITY_SCOPED: {
    id: "opportunity_scoped" as const,
    description: "User wants to find opportunities within a specific community",
    examples: [
      "Find mentors in the AI Founders index",
      "Search only in my React group",
      "Who can help me in the fintech community?",
    ],
    expectedTools: ["read_indexes", "create_opportunities"],
    messages: {
      direct_requester: "Find mentors in AI Founders",
      exploratory_seeker: "Who can help me in the AI Founders community?",
      technical_precise: "Search for mentors within the AI Founders Network index only, exclude other indexes",
      vague_requester: "Find someone there",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // URL SCRAPING (Tool: scrape_url)
  // ═══════════════════════════════════════════════════════════════════════════════

  URL_SCRAPE: {
    id: "url_scrape" as const,
    description: "User wants to extract information from a URL",
    examples: [
      "What's this article about? https://example.com/article",
      "Scrape this page for me",
      "What does this link say?",
    ],
    expectedTools: ["scrape_url"],
    messages: {
      direct_requester: "Scrape https://example.com/article",
      exploratory_seeker: "Can you tell me what's on this page? https://example.com/article",
      technical_precise: "Extract and summarize content from https://example.com/article",
      vague_requester: "What's this? https://example.com/article",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONFIRMATION FLOW (Tools: confirm_action, cancel_action)
  // ═══════════════════════════════════════════════════════════════════════════════

  CONFIRMATION_ACCEPT: {
    id: "confirmation_accept" as const,
    description: "User confirms a pending destructive action",
    examples: [
      "Yes, update it",
      "Confirm",
      "Go ahead and delete it",
    ],
    expectedTools: ["confirm_action"],
    messages: {
      direct_requester: "Yes, confirm",
      exploratory_seeker: "Yes, that looks good",
      technical_precise: "Confirmed, execute the pending action",
      vague_requester: "OK",
    },
  },

  CONFIRMATION_CANCEL: {
    id: "confirmation_cancel" as const,
    description: "User cancels a pending action",
    examples: [
      "No, cancel that",
      "Never mind",
      "Don't delete it",
    ],
    expectedTools: ["cancel_action"],
    messages: {
      direct_requester: "Cancel",
      exploratory_seeker: "Actually, never mind",
      technical_precise: "Cancel the pending confirmation",
      vague_requester: "No",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // CLARIFICATION & EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════════

  CLARIFICATION_NEEDED: {
    id: "clarification_needed" as const,
    description: "User request is ambiguous and needs clarification",
    examples: [
      "Help me with my profile",
      "I need to find someone",
      "Update my stuff",
    ],
    expectedTools: [], // Agent should ask clarifying questions, not call tools
    messages: {
      direct_requester: "Update it",
      exploratory_seeker: "Can you help me?",
      technical_precise: "Modify the resource",
      vague_requester: "Do something",
    },
  },

  MULTI_STEP_WORKFLOW: {
    id: "multi_step_workflow" as const,
    description: "User request requires multiple tool calls in sequence",
    examples: [
      "Create a new index and add my hiring intent to it",
      "Find mentors and send an intro to the best match",
      "Show me my profile, intents, and opportunities",
    ],
    expectedTools: [], // Multiple tools depending on request
    messages: {
      direct_requester: "Show my profile, intents, and communities",
      exploratory_seeker: "Can you give me an overview of everything I have?",
      technical_precise: "Execute read_user_profiles, read_intents, and read_indexes in sequence",
      vague_requester: "Show me everything",
    },
  },

  NO_ACTION_NEEDED: {
    id: "no_action_needed" as const,
    description: "User statement requires conversational response only",
    examples: [
      "Thanks for your help!",
      "That's perfect",
      "Great, I appreciate it",
    ],
    expectedTools: [], // No tools, just respond
    messages: {
      direct_requester: "Thanks",
      exploratory_seeker: "Thank you so much!",
      technical_precise: "Acknowledged",
      vague_requester: "Cool",
    },
  },
} as const;

export type UserNeed = (typeof CHAT_AGENT_USER_NEEDS)[keyof typeof CHAT_AGENT_USER_NEEDS];

// Convenience export for backward compatibility
export { CHAT_AGENT_USER_NEEDS as USER_NEEDS };

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-GENERATED SCENARIO LOADER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load pre-generated scenarios from the definitions above (no LLM calls).
 * This is fast and deterministic.
 */
export function loadPregeneratedScenarios(): Array<{
  id: string;
  needId: string;
  personaId: string;
  message: string;
}> {
  const scenarios: Array<{
    id: string;
    needId: string;
    personaId: string;
    message: string;
  }> = [];
  
  const needIds = Object.keys(CHAT_AGENT_USER_NEEDS) as Array<keyof typeof CHAT_AGENT_USER_NEEDS>;
  const personaIds = Object.keys(USER_PERSONAS) as Array<keyof typeof USER_PERSONAS>;

  // Generate all combinations of need × persona
  for (const needId of needIds) {
    for (const personaId of personaIds) {
      const need = CHAT_AGENT_USER_NEEDS[needId];
      
      // Get pre-generated message for this persona
      const message = 'messages' in need && need.messages && personaId in need.messages
        ? (need.messages as any)[personaId]
        : need.examples[0]; // Fallback to first example

      scenarios.push({
        id: `${needId}-${personaId}`,
        needId: String(needId),
        personaId: String(personaId),
        message,
      });
    }
  }

  return scenarios;
}

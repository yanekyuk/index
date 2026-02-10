/**
 * Scenario Definitions for Chat Agent Evaluation
 * Self-contained, no protocol imports.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// USER PERSONAS - Communication Styles
// ═══════════════════════════════════════════════════════════════════════════════

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

export type UserPersona = (typeof USER_PERSONAS)[keyof typeof USER_PERSONAS];
export type UserPersonaId = keyof typeof USER_PERSONAS;

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

export const CATEGORIES = {
  profile: "profile",
  intent: "intent",
  index: "index",
  intent_index: "intent_index",
  discovery: "discovery",
  url: "url",
  edge_case: "edge_case",
} as const;

export type Category = (typeof CATEGORIES)[keyof typeof CATEGORIES];

// ═══════════════════════════════════════════════════════════════════════════════
// USER NEEDS - Task Taxonomy (abbreviated - full defs in protocol)
// ═══════════════════════════════════════════════════════════════════════════════

type NeedDef = {
  id: string;
  category: Category;
  description: string;
  examples: string[];
  expectedTools: readonly string[];
  messages: Record<string, string>;
};

export const CHAT_AGENT_USER_NEEDS: Record<string, NeedDef> = {
  PROFILE_CREATE: { id: "profile_create", category: "profile", description: "User wants to create their profile", examples: ["Create my profile"], expectedTools: ["create_user_profile"], messages: { direct_requester: "Create my profile: software engineer, AI/ML, SF Bay Area", exploratory_seeker: "Hi! I'd like to set up my profile... how do I get started?", technical_precise: "Create profile with the following: Senior Software Engineer, 8 years experience", vague_requester: "I need a profile" } },
  PROFILE_VIEW: { id: "profile_view", category: "profile", description: "User wants to view their profile", examples: ["Show me my profile"], expectedTools: ["read_user_profiles"], messages: { direct_requester: "Show my profile", exploratory_seeker: "Can I see what's in my profile?", technical_precise: "Display my complete profile information", vague_requester: "What do I have?" } },
  PROFILE_UPDATE: { id: "profile_update", category: "profile", description: "User wants to update their profile", examples: ["Update my bio"], expectedTools: ["read_user_profiles", "update_user_profile"], messages: { direct_requester: "Add Python and Rust to my skills", exploratory_seeker: "I'd like to update my profile with some new skills... can you help?", technical_precise: "Update profile: add Python, Rust, and Kubernetes", vague_requester: "Update my stuff" } },
  PROFILE_FROM_URL: { id: "profile_from_url", category: "profile", description: "User wants to create profile from URL", examples: ["Create my profile from linkedin.com/in/johndoe"], expectedTools: ["create_user_profile"], messages: { direct_requester: "Create my profile from linkedin.com/in/johndoe", exploratory_seeker: "Can you import my profile from my LinkedIn?", technical_precise: "Generate my profile using my LinkedIn at linkedin.com/in/johndoe", vague_requester: "Use my LinkedIn" } },
  PROFILE_UPDATE_FROM_URL: { id: "profile_update_from_url", category: "profile", description: "User wants to update profile from URL", examples: ["Update my profile with this GitHub"], expectedTools: ["scrape_url", "update_user_profile"], messages: { direct_requester: "Update my profile with github.com/jdoe", exploratory_seeker: "I have a new portfolio site — can you update my profile from it?", technical_precise: "Scrape linkedin.com/in/johndoe and update my existing profile", vague_requester: "Update my profile from my website" } },
  INTENT_CREATE: { id: "intent_create", category: "intent", description: "User explicitly asks to create/add an intent", examples: ["Add an intent: hiring React developers"], expectedTools: ["create_intent"], messages: { direct_requester: "Create intent: Find AI ethics researchers", exploratory_seeker: "I'd like to save an intent about finding AI ethics researchers", technical_precise: "Create a new intent: Looking for AI ethics researchers", vague_requester: "Add an intent" } },
  INTENT_VIEW: { id: "intent_view", category: "intent", description: "User wants to see their intents", examples: ["Show me my intents"], expectedTools: ["read_intents"], messages: { direct_requester: "Show my intents", exploratory_seeker: "What goals do I have saved?", technical_precise: "List all my active intents", vague_requester: "What do I want?" } },
  INTENT_UPDATE: { id: "intent_update", category: "intent", description: "User wants to modify an existing intent", examples: ["Update my hiring intent"], expectedTools: ["read_intents", "update_intent"], messages: { direct_requester: "Update my hiring intent to focus on senior engineers only", exploratory_seeker: "Can I change that intent to be more specific?", technical_precise: "Update the hiring intent to: Seeking senior full-stack engineers", vague_requester: "Change that thing" } },
  INTENT_DELETE: { id: "intent_delete", category: "intent", description: "User wants to remove an intent", examples: ["Delete my hiring intent"], expectedTools: ["read_intents", "delete_intent"], messages: { direct_requester: "Delete my co-founder intent", exploratory_seeker: "I don't need that intent anymore... can you remove it?", technical_precise: "Archive the intent with description 'Looking for technical co-founder'", vague_requester: "Get rid of that" } },
  INTENT_FROM_URL: { id: "intent_from_url", category: "intent", description: "User shares URL and wants to create intent from content", examples: ["Create an intent from this project"], expectedTools: ["scrape_url", "create_intent"], messages: { direct_requester: "Create an intent from github.com/org/ml-framework", exploratory_seeker: "I found this interesting project — can you help me find similar people?", technical_precise: "Scrape github.com/org/ml-framework and create an intent", vague_requester: "Use this link for an intent" } },
  INDEX_VIEW: { id: "index_view", category: "index", description: "User wants to see their indexes/communities", examples: ["Show me my communities"], expectedTools: ["read_indexes"], messages: { direct_requester: "List my indexes", exploratory_seeker: "What communities am I part of?", technical_precise: "Display all indexes where I'm a member", vague_requester: "Show my groups" } },
  INDEX_CREATE: { id: "index_create", category: "index", description: "User wants to create a new community", examples: ["Create an index for fintech builders"], expectedTools: ["create_index"], messages: { direct_requester: "Create index: AI Founders Network", exploratory_seeker: "I want to start a community for AI founders... how do I create one?", technical_precise: "Create a new index titled 'AI Founders Network'", vague_requester: "Make a group" } },
  INDEX_UPDATE: { id: "index_update", category: "index", description: "User wants to modify community settings", examples: ["Update my index description"], expectedTools: ["read_indexes", "update_index"], messages: { direct_requester: "Make AI Founders index invite-only", exploratory_seeker: "Can I change my community settings to be more private?", technical_precise: "Update the AI Founders Network index: set join policy to invite-only", vague_requester: "Change the settings" } },
  INDEX_DELETE: { id: "index_delete", category: "index", description: "User wants to delete their community", examples: ["Delete my test index"], expectedTools: ["read_indexes", "delete_index"], messages: { direct_requester: "Delete my Test Community index", exploratory_seeker: "I don't need that community anymore... can you delete it?", technical_precise: "Remove the index titled 'Test Community'", vague_requester: "Delete that" } },
  INDEX_MEMBERS_VIEW: { id: "index_members_view", category: "index", description: "User wants to see who's in a community", examples: ["Who's in the AI Founders index?"], expectedTools: ["read_users"], messages: { direct_requester: "Show members in AI Founders", exploratory_seeker: "Who's in my community?", technical_precise: "List all members of the AI Founders Network index", vague_requester: "Who's in there?" } },
  INDEX_MEMBER_ADD: { id: "index_member_add", category: "index", description: "User wants to add someone to their community", examples: ["Add Sarah to my fintech community"], expectedTools: ["create_index_membership"], messages: { direct_requester: "Add user Sarah Chen to AI Founders index", exploratory_seeker: "Can I invite someone to join my community?", technical_precise: "Add user to the AI Founders Network index", vague_requester: "Add them" } },
  INTENT_INDEX_LINK: { id: "intent_index_link", category: "intent_index", description: "User wants to add intent to a community", examples: ["Add my hiring intent to the AI Founders index"], expectedTools: ["read_intents", "read_indexes", "create_intent_index"], messages: { direct_requester: "Add my hiring intent to AI Founders", exploratory_seeker: "Can I add my intent to the AI Founders community?", technical_precise: "Link my hiring intent to the AI Founders Network index", vague_requester: "Put it in there" } },
  INTENT_INDEX_VIEW: { id: "intent_index_view", category: "intent_index", description: "User wants to see all intents in a community", examples: ["Show all intents in the AI Founders index"], expectedTools: ["read_intents"], messages: { direct_requester: "Show all intents in AI Founders", exploratory_seeker: "What is everyone looking for in our community?", technical_precise: "List all intents associated with the AI Founders Network index", vague_requester: "What's in there?" } },
  INTENT_INDEX_UNLINK: { id: "intent_index_unlink", category: "intent_index", description: "User wants to remove intent from a community", examples: ["Remove my hiring intent from this index"], expectedTools: ["read_intents", "read_indexes", "delete_intent_index"], messages: { direct_requester: "Remove my hiring intent from AI Founders", exploratory_seeker: "Can I take that intent out of the community?", technical_precise: "Remove the link between my hiring intent and the AI Founders Network index", vague_requester: "Take it out" } },
  DISCOVERY_HIRE: { id: "discovery_hire", category: "discovery", description: "User is looking to hire or recruit", examples: ["I need AI/ML engineers for my startup"], expectedTools: ["create_intent"], messages: { direct_requester: "I need AI/ML engineers for my startup", exploratory_seeker: "I'm building a team and looking for strong ML engineers... anyone around?", technical_precise: "I'm seeking senior ML engineers with 5+ years experience", vague_requester: "I need to find some people to hire" } },
  DISCOVERY_COFOUNDER: { id: "discovery_cofounder", category: "discovery", description: "User is looking for a co-founder", examples: ["I'm looking for a technical co-founder"], expectedTools: ["create_intent"], messages: { direct_requester: "Looking for a technical co-founder for my fintech startup", exploratory_seeker: "I've got this startup idea but I need a co-founder... can you help?", technical_precise: "Seeking a technical co-founder with distributed systems expertise", vague_requester: "I want a co-founder" } },
  DISCOVERY_COLLABORATE: { id: "discovery_collaborate", category: "discovery", description: "User wants to find collaborators", examples: ["Looking for someone to collaborate on an open-source project"], expectedTools: ["create_intent"], messages: { direct_requester: "Find collaborators for my open-source ML framework", exploratory_seeker: "I'm working on a research project and could use a collaborator... anyone interested?", technical_precise: "Looking for collaborators with experience in federated learning", vague_requester: "I want to work on something with someone" } },
  DISCOVERY_IDEA_SHARE: { id: "discovery_idea_share", category: "discovery", description: "User wants to share ideas, get feedback", examples: ["I want to discuss AI safety with others"], expectedTools: ["create_intent"], messages: { direct_requester: "Find people interested in discussing AI alignment and safety", exploratory_seeker: "I've been thinking a lot about decentralized social media... anyone else exploring that?", technical_precise: "Looking for individuals interested in on-device LLM inference", vague_requester: "I want to talk about ideas with people" } },
  DISCOVERY_NETWORKING: { id: "discovery_networking", category: "discovery", description: "User wants to expand professional network", examples: ["I want to meet other founders in climate tech"], expectedTools: ["create_intent"], messages: { direct_requester: "Connect me with climate tech founders", exploratory_seeker: "I'm new here and want to get to know other people in the AI space... who should I meet?", technical_precise: "Looking to network with Series A and B founders", vague_requester: "I want to meet people" } },
  DISCOVERY_MENTOR: { id: "discovery_mentor", category: "discovery", description: "User is looking for a mentor", examples: ["Find me a mentor in product management"], expectedTools: ["create_intent"], messages: { direct_requester: "Find me a mentor for early-stage fundraising", exploratory_seeker: "I could really use some guidance on product strategy... anyone who could mentor me?", technical_precise: "Seeking an experienced advisor with B2B SaaS go-to-market background", vague_requester: "I need a mentor" } },
  DISCOVERY_PEER: { id: "discovery_peer", category: "discovery", description: "User wants to find peers", examples: ["Find other solo founders to chat with"], expectedTools: ["create_intent"], messages: { direct_requester: "Find other solo founders building AI products", exploratory_seeker: "Are there other people here who are also early-stage and working on something in AI?", technical_precise: "Looking for fellow pre-seed founders in the AI agent space", vague_requester: "Anyone like me here?" } },
  DISCOVERY_INVESTOR: { id: "discovery_investor", category: "discovery", description: "User is looking for investors", examples: ["I want to connect with fintech investors"], expectedTools: ["create_intent"], messages: { direct_requester: "Find angel investors interested in AI infrastructure", exploratory_seeker: "I'm raising a pre-seed round... anyone here who invests in AI?", technical_precise: "Seeking seed-stage investors with portfolio focus on developer tools", vague_requester: "I need funding" } },
  DISCOVERY_SERVICE: { id: "discovery_service", category: "discovery", description: "User is looking for a service provider", examples: ["I need a designer for my landing page"], expectedTools: ["create_intent"], messages: { direct_requester: "Find a freelance product designer for a SaaS dashboard", exploratory_seeker: "I need help with my landing page design... know anyone good?", technical_precise: "Looking for a contract DevOps engineer experienced with Kubernetes", vague_requester: "I need help with something" } },
  DISCOVERY_EXISTING: { id: "discovery_existing", category: "discovery", description: "User asks to discover using existing intents", examples: ["Find me opportunities"], expectedTools: ["create_opportunities", "list_opportunities"], messages: { direct_requester: "Find me opportunities", exploratory_seeker: "Who should I connect with based on what I'm already looking for?", technical_precise: "Run discovery against my existing intents", vague_requester: "Find someone for me" } },
  DISCOVERY_LIST: { id: "discovery_list", category: "discovery", description: "User wants to see existing opportunities", examples: ["Show my opportunities"], expectedTools: ["list_opportunities"], messages: { direct_requester: "Show my opportunities", exploratory_seeker: "What connections have been suggested for me?", technical_precise: "List all my opportunities with status and confidence scores", vague_requester: "What do I have?" } },
  DISCOVERY_SEND: { id: "discovery_send", category: "discovery", description: "User wants to send/activate a draft opportunity", examples: ["Send intro to Sarah"], expectedTools: ["list_opportunities", "send_opportunity"], messages: { direct_requester: "Send the first opportunity", exploratory_seeker: "Can you send an intro to that person?", technical_precise: "Send the draft opportunity for the ML engineer match", vague_requester: "Send it" } },
  URL_SCRAPE: { id: "url_scrape", category: "url", description: "User wants to extract information from a URL", examples: ["What's this article about? example.com/article"], expectedTools: ["scrape_url"], messages: { direct_requester: "Scrape example.com/article", exploratory_seeker: "Can you tell me what's on this page? example.com/article", technical_precise: "Extract and summarize content from techblog.io/posts/scaling-ml-infra", vague_requester: "What's this? example.com/article" } },
  CLARIFICATION_NEEDED: { id: "clarification_needed", category: "edge_case", description: "User request is too ambiguous", examples: ["Help me"], expectedTools: [], messages: { direct_requester: "Update it", exploratory_seeker: "Can you help me?", technical_precise: "Modify the resource", vague_requester: "Do something" } },
  MULTI_STEP_WORKFLOW: { id: "multi_step_workflow", category: "edge_case", description: "User request requires multiple tool calls", examples: ["Create a new index and add my hiring intent"], expectedTools: [], messages: { direct_requester: "Show my profile, intents, and communities", exploratory_seeker: "Can you give me an overview of everything I have?", technical_precise: "Fetch my profile, list my intents, and list my indexes in parallel", vague_requester: "Show me everything" } },
  NO_ACTION_NEEDED: { id: "no_action_needed", category: "edge_case", description: "User statement requires conversational response only", examples: ["Thanks for your help!"], expectedTools: [], messages: { direct_requester: "Thanks", exploratory_seeker: "Thank you so much!", technical_precise: "Acknowledged", vague_requester: "Cool" } },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO TYPE
// ═══════════════════════════════════════════════════════════════════════════════

export interface Scenario {
  id: string;
  needId: string;
  personaId: string;
  message: string;
  category: Category;
  tools: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-GENERATED SCENARIO LOADER
// ═══════════════════════════════════════════════════════════════════════════════

export function loadPregeneratedScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];
  const needIds = Object.keys(CHAT_AGENT_USER_NEEDS);
  const personaIds = Object.keys(USER_PERSONAS);

  for (const needId of needIds) {
    for (const personaId of personaIds) {
      const need = CHAT_AGENT_USER_NEEDS[needId]!;
      const personaKey = USER_PERSONAS[personaId as UserPersonaId].id;
      const message =
        personaKey in need.messages
          ? (need.messages as Record<string, string>)[personaKey]
          : need.examples[0]!;

      scenarios.push({
        id: `${needId}-${personaId}`,
        needId,
        personaId,
        message,
        category: need.category,
        tools: need.expectedTools,
      });
    }
  }
  return scenarios;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILTER
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScenarioFilter {
  persona?: UserPersonaId | "all";
  tool?: string | "all";
  category?: Category | "all";
}

export function filterScenarios(
  scenarios: Scenario[],
  filter: ScenarioFilter = {}
): Scenario[] {
  const { persona = "all", tool = "all", category = "all" } = filter;
  return scenarios.filter((s) => {
    if (persona !== "all" && s.personaId !== persona) return false;
    if (category !== "all" && s.category !== category) return false;
    if (tool !== "all" && !s.tools.includes(tool)) return false;
    return true;
  });
}

export function allToolNames(): string[] {
  const set = new Set<string>();
  for (const need of Object.values(CHAT_AGENT_USER_NEEDS)) {
    for (const t of need.expectedTools) set.add(t);
  }
  return [...set].sort();
}

export function allCategories(): Category[] {
  return Object.values(CATEGORIES);
}

export function allPersonaIds(): UserPersonaId[] {
  return Object.keys(USER_PERSONAS) as UserPersonaId[];
}

/**
 * Scenario Definitions for Chat Agent Evaluation
 * Self-contained, no protocol imports.
 */

import type { SeedRequirement } from "./seed/seed.types";
import { DEFAULT_SEED_REQUIREMENTS } from "./seed/seed.types";

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
  meta: "meta",
} as const;

export type Category = (typeof CATEGORIES)[keyof typeof CATEGORIES];

// ═══════════════════════════════════════════════════════════════════════════════
// USER NEEDS - Task Taxonomy
// ═══════════════════════════════════════════════════════════════════════════════

type NeedDef = {
  id: string;
  category: Category;
  question: string;
  expectation: string;
  messages: Record<string, string>;
};

export const CHAT_AGENT_USER_NEEDS: Record<string, NeedDef> = {
  PROFILE_CREATE: { id: "profile_create", category: "profile", question: "User wants to create their profile", expectation: "Agent should invoke profile creation and confirm the profile was created", messages: { direct_requester: "Create my profile: software engineer, AI/ML, SF Bay Area", exploratory_seeker: "Hi! I'd like to set up my profile... how do I get started?", technical_precise: "Create profile with the following: Senior Software Engineer, 8 years experience", vague_requester: "I need a profile" } },
  PROFILE_VIEW: { id: "profile_view", category: "profile", question: "User wants to view their profile", expectation: "Agent should retrieve and display the user's profile information", messages: { direct_requester: "Show my profile", exploratory_seeker: "Can I see what's in my profile?", technical_precise: "Display my complete profile information", vague_requester: "What do I have?" } },
  PROFILE_UPDATE: { id: "profile_update", category: "profile", question: "User wants to update their profile", expectation: "Agent should read current profile and apply the requested updates", messages: { direct_requester: "Add Python and Rust to my skills", exploratory_seeker: "I'd like to update my profile with some new skills... can you help?", technical_precise: "Update profile: add Python, Rust, and Kubernetes", vague_requester: "Update my stuff" } },
  PROFILE_FROM_URL: { id: "profile_from_url", category: "profile", question: "User wants to create profile from URL", expectation: "Agent should scrape the URL and create a profile from the extracted content", messages: { direct_requester: "Create my profile from linkedin.com/in/johndoe", exploratory_seeker: "Can you import my profile from my LinkedIn?", technical_precise: "Generate my profile using my LinkedIn at linkedin.com/in/johndoe", vague_requester: "Use my LinkedIn" } },
  PROFILE_UPDATE_FROM_URL: { id: "profile_update_from_url", category: "profile", question: "User wants to update profile from URL", expectation: "Agent should scrape the URL and update the existing profile with new information", messages: { direct_requester: "Update my profile with github.com/jdoe", exploratory_seeker: "I have a new portfolio site — can you update my profile from it?", technical_precise: "Scrape linkedin.com/in/johndoe and update my existing profile", vague_requester: "Update my profile from my website" } },
  INTENT_CREATE: { id: "intent_create", category: "intent", question: "User explicitly asks to create/add an intent", expectation: "Agent should create a new intent with the specified details", messages: { direct_requester: "Create intent: Find AI ethics researchers", exploratory_seeker: "I'd like to save an intent about finding AI ethics researchers", technical_precise: "Create a new intent: Looking for AI ethics researchers", vague_requester: "Add an intent" } },
  INTENT_VIEW: { id: "intent_view", category: "intent", question: "User wants to see their intents", expectation: "Agent should list the user's active intents", messages: { direct_requester: "Show my intents", exploratory_seeker: "What goals do I have saved?", technical_precise: "List all my active intents", vague_requester: "What do I want?" } },
  INTENT_UPDATE: { id: "intent_update", category: "intent", question: "User wants to modify an existing intent", expectation: "Agent should find and update the specified intent", messages: { direct_requester: "Update my hiring intent to focus on senior engineers only", exploratory_seeker: "Can I change that intent to be more specific?", technical_precise: "Update the hiring intent to: Seeking senior full-stack engineers", vague_requester: "Change that thing" } },
  INTENT_DELETE: { id: "intent_delete", category: "intent", question: "User wants to remove an intent", expectation: "Agent should find and delete the specified intent", messages: { direct_requester: "Delete my co-founder intent", exploratory_seeker: "I don't need that intent anymore... can you remove it?", technical_precise: "Archive the intent with description 'Looking for technical co-founder'", vague_requester: "Get rid of that" } },
  INTENT_FROM_URL: { id: "intent_from_url", category: "intent", question: "User shares URL and wants to create intent from content", expectation: "Agent should scrape the URL and create an intent based on the extracted content", messages: { direct_requester: "Create an intent from github.com/org/ml-framework", exploratory_seeker: "I found this interesting project — can you help me find similar people?", technical_precise: "Scrape github.com/org/ml-framework and create an intent", vague_requester: "Use this link for an intent" } },
  INDEX_VIEW: { id: "index_view", category: "index", question: "User wants to see their indexes/communities", expectation: "Agent should list all indexes the user belongs to", messages: { direct_requester: "List my indexes", exploratory_seeker: "What communities am I part of?", technical_precise: "Display all indexes where I'm a member", vague_requester: "Show my groups" } },
  INDEX_CREATE: { id: "index_create", category: "index", question: "User wants to create a new community", expectation: "Agent should create a new index with the given name/description", messages: { direct_requester: "Create index: AI Founders Network", exploratory_seeker: "I want to start a community for AI founders... how do I create one?", technical_precise: "Create a new index titled 'AI Founders Network'", vague_requester: "Make a group" } },
  INDEX_UPDATE: { id: "index_update", category: "index", question: "User wants to modify community settings", expectation: "Agent should find and update the specified index settings", messages: { direct_requester: "Make AI Founders index invite-only", exploratory_seeker: "Can I change my community settings to be more private?", technical_precise: "Update the AI Founders Network index: set join policy to invite-only", vague_requester: "Change the settings" } },
  INDEX_DELETE: { id: "index_delete", category: "index", question: "User wants to delete their community", expectation: "Agent should find and delete the specified index", messages: { direct_requester: "Delete my Test Community index", exploratory_seeker: "I don't need that community anymore... can you delete it?", technical_precise: "Remove the index titled 'Test Community'", vague_requester: "Delete that" } },
  INDEX_MEMBERS_VIEW: { id: "index_members_view", category: "index", question: "User wants to see who's in a community", expectation: "Agent should list members of the specified index", messages: { direct_requester: "Show members in AI Founders", exploratory_seeker: "Who's in my community?", technical_precise: "List all members of the AI Founders Network index", vague_requester: "Who's in there?" } },
  INDEX_MEMBER_ADD: { id: "index_member_add", category: "index", question: "User wants to add someone to their community", expectation: "Agent should add the specified user to the index", messages: { direct_requester: "Add user Sarah Chen to AI Founders index", exploratory_seeker: "Can I invite someone to join my community?", technical_precise: "Add user to the AI Founders Network index", vague_requester: "Add them" } },
  INTENT_INDEX_LINK: { id: "intent_index_link", category: "intent_index", question: "User wants to add intent to a community", expectation: "Agent should link the specified intent to the specified index", messages: { direct_requester: "Add my hiring intent to AI Founders", exploratory_seeker: "Can I add my intent to the AI Founders community?", technical_precise: "Link my hiring intent to the AI Founders Network index", vague_requester: "Put it in there" } },
  INTENT_INDEX_VIEW: { id: "intent_index_view", category: "intent_index", question: "User wants to see all intents in a community", expectation: "Agent should list all intents associated with the specified index", messages: { direct_requester: "Show all intents in AI Founders", exploratory_seeker: "What is everyone looking for in our community?", technical_precise: "List all intents associated with the AI Founders Network index", vague_requester: "What's in there?" } },
  INTENT_INDEX_UNLINK: { id: "intent_index_unlink", category: "intent_index", question: "User wants to remove intent from a community", expectation: "Agent should unlink the specified intent from the specified index", messages: { direct_requester: "Remove my hiring intent from AI Founders", exploratory_seeker: "Can I take that intent out of the community?", technical_precise: "Remove the link between my hiring intent and the AI Founders Network index", vague_requester: "Take it out" } },
  DISCOVERY_HIRE: { id: "discovery_hire", category: "discovery", question: "User is looking to hire or recruit", expectation: "Agent should create a hiring intent and/or find matching candidates", messages: { direct_requester: "I need AI/ML engineers for my startup", exploratory_seeker: "I'm building a team and looking for strong ML engineers... anyone around?", technical_precise: "I'm seeking senior ML engineers with 5+ years experience", vague_requester: "I need to find some people to hire" } },
  DISCOVERY_COFOUNDER: { id: "discovery_cofounder", category: "discovery", question: "User is looking for a co-founder", expectation: "Agent should create a co-founder search intent and find relevant matches", messages: { direct_requester: "Looking for a technical co-founder for my fintech startup", exploratory_seeker: "I've got this startup idea but I need a co-founder... can you help?", technical_precise: "Seeking a technical co-founder with distributed systems expertise", vague_requester: "I want a co-founder" } },
  DISCOVERY_COLLABORATE: { id: "discovery_collaborate", category: "discovery", question: "User wants to find collaborators", expectation: "Agent should create a collaboration intent and find potential collaborators", messages: { direct_requester: "Find collaborators for my open-source ML framework", exploratory_seeker: "I'm working on a research project and could use a collaborator... anyone interested?", technical_precise: "Looking for collaborators with experience in federated learning", vague_requester: "I want to work on something with someone" } },
  DISCOVERY_IDEA_SHARE: { id: "discovery_idea_share", category: "discovery", question: "User wants to share ideas, get feedback", expectation: "Agent should create an intent for idea exchange and find like-minded people", messages: { direct_requester: "Find people interested in discussing AI alignment and safety", exploratory_seeker: "I've been thinking a lot about decentralized social media... anyone else exploring that?", technical_precise: "Looking for individuals interested in on-device LLM inference", vague_requester: "I want to talk about ideas with people" } },
  DISCOVERY_NETWORKING: { id: "discovery_networking", category: "discovery", question: "User wants to expand professional network", expectation: "Agent should create a networking intent and find relevant connections", messages: { direct_requester: "Connect me with climate tech founders", exploratory_seeker: "I'm new here and want to get to know other people in the AI space... who should I meet?", technical_precise: "Looking to network with Series A and B founders", vague_requester: "I want to meet people" } },
  DISCOVERY_MENTOR: { id: "discovery_mentor", category: "discovery", question: "User is looking for a mentor", expectation: "Agent should create a mentorship intent and find potential mentors", messages: { direct_requester: "Find me a mentor for early-stage fundraising", exploratory_seeker: "I could really use some guidance on product strategy... anyone who could mentor me?", technical_precise: "Seeking an experienced advisor with B2B SaaS go-to-market background", vague_requester: "I need a mentor" } },
  DISCOVERY_PEER: { id: "discovery_peer", category: "discovery", question: "User wants to find peers", expectation: "Agent should create a peer-finding intent and discover similar users", messages: { direct_requester: "Find other solo founders building AI products", exploratory_seeker: "Are there other people here who are also early-stage and working on something in AI?", technical_precise: "Looking for fellow pre-seed founders in the AI agent space", vague_requester: "Anyone like me here?" } },
  DISCOVERY_INVESTOR: { id: "discovery_investor", category: "discovery", question: "User is looking for investors", expectation: "Agent should create an investor-search intent and find relevant investors", messages: { direct_requester: "Find angel investors interested in AI infrastructure", exploratory_seeker: "I'm raising a pre-seed round... anyone here who invests in AI?", technical_precise: "Seeking seed-stage investors with portfolio focus on developer tools", vague_requester: "I need funding" } },
  DISCOVERY_SERVICE: { id: "discovery_service", category: "discovery", question: "User is looking for a service provider", expectation: "Agent should create a service-search intent and find relevant providers", messages: { direct_requester: "Find a freelance product designer for a SaaS dashboard", exploratory_seeker: "I need help with my landing page design... know anyone good?", technical_precise: "Looking for a contract DevOps engineer experienced with Kubernetes", vague_requester: "I need help with something" } },
  DISCOVERY_EXISTING: { id: "discovery_existing", category: "discovery", question: "User asks to discover using existing intents", expectation: "Agent should run discovery against user's existing intents and return opportunities", messages: { direct_requester: "Find me opportunities", exploratory_seeker: "Who should I connect with based on what I'm already looking for?", technical_precise: "Run discovery against my existing intents", vague_requester: "Find someone for me" } },
  DISCOVERY_LIST: { id: "discovery_list", category: "discovery", question: "User wants to see existing opportunities", expectation: "Agent should list the user's current opportunities", messages: { direct_requester: "Show my opportunities", exploratory_seeker: "What connections have been suggested for me?", technical_precise: "List all my opportunities with status and confidence scores", vague_requester: "What do I have?" } },
  DISCOVERY_SEND: { id: "discovery_send", category: "discovery", question: "User wants to send/activate a draft opportunity", expectation: "Agent should find and send the specified draft opportunity", messages: { direct_requester: "Send the first opportunity", exploratory_seeker: "Can you send an intro to that person?", technical_precise: "Send the draft opportunity for the ML engineer match", vague_requester: "Send it" } },
  URL_SCRAPE: { id: "url_scrape", category: "url", question: "User wants to extract information from a URL", expectation: "Agent should scrape the URL and return a summary of the content", messages: { direct_requester: "Scrape example.com/article", exploratory_seeker: "Can you tell me what's on this page? example.com/article", technical_precise: "Extract and summarize content from techblog.io/posts/scaling-ml-infra", vague_requester: "What's this? example.com/article" } },
  CLARIFICATION_NEEDED: { id: "clarification_needed", category: "edge_case", question: "User request is too ambiguous", expectation: "Agent should ask clarifying questions instead of guessing", messages: { direct_requester: "Update it", exploratory_seeker: "Can you help me?", technical_precise: "Modify the resource", vague_requester: "Do something" } },
  MULTI_STEP_WORKFLOW: { id: "multi_step_workflow", category: "edge_case", question: "User request requires multiple tool calls", expectation: "Agent should handle the multi-step request by chaining appropriate actions", messages: { direct_requester: "Show my profile, intents, and communities", exploratory_seeker: "Can you give me an overview of everything I have?", technical_precise: "Fetch my profile, list my intents, and list my indexes in parallel", vague_requester: "Show me everything" } },
  NO_ACTION_NEEDED: { id: "no_action_needed", category: "edge_case", question: "User statement requires conversational response only", expectation: "Agent should respond conversationally without invoking any tools", messages: { direct_requester: "Thanks", exploratory_seeker: "Thank you so much!", technical_precise: "Acknowledged", vague_requester: "Cool" } },

  // ─── Profile Analysis ─────────────────────────────────────────────────────────
  PROFILE_SELF_VIEW: { id: "profile_self_view", category: "profile", question: "How am I showing up?", expectation: "Agent returns a summary of my profile as others see it — bio, skills, interests, current intents. Shows me the version of myself that's visible in the network.", messages: { direct_requester: "How am I showing up?", exploratory_seeker: "I'm curious — what do other people actually see when they look at my profile?", technical_precise: "Show me my public-facing profile as it appears to other users in the network", vague_requester: "What do people see about me?" } },
  PROFILE_SUMMARIZE: { id: "profile_summarize", category: "profile", question: "How would you summarize me?", expectation: "Agent gives a 2-3 sentence synthesis of who I am based on my profile and intents. The essence of what I'm about.", messages: { direct_requester: "How would you summarize me?", exploratory_seeker: "If you had to describe me to someone in a few sentences, what would you say?", technical_precise: "Generate a 2-3 sentence synthesis of my profile and intents", vague_requester: "What am I about?" } },
  PROFILE_REWRITE_BIO: { id: "profile_rewrite_bio", category: "profile", question: "Rewrite my bio", expectation: "Agent searches for recent updates about me online (LinkedIn, Twitter, GitHub, personal site, recent projects), pulls in new information, then rewrites my bio to reflect current work and focus. Can take direction on tone/angle if I specify.", messages: { direct_requester: "Rewrite my bio", exploratory_seeker: "My bio feels outdated — can you look me up online and rewrite it based on what I'm actually doing now?", technical_precise: "Research my latest online presence across LinkedIn, GitHub, and Twitter, then rewrite my bio to reflect current focus", vague_requester: "My bio needs updating" } },
  PROFILE_GAP_ANALYSIS: { id: "profile_gap_analysis", category: "profile", question: "What am I missing in my profile?", expectation: "Agent identifies gaps — weak bio, vague intents, missing skills, areas where I'm not signaling clearly enough for the right people to find me.", messages: { direct_requester: "What am I missing in my profile?", exploratory_seeker: "Is there anything I should add to my profile to be more discoverable?", technical_precise: "Analyze my profile for gaps in bio, skills, intents, and discoverability signals", vague_requester: "Is my profile good enough?" } },
  PROFILE_PATTERN_ANALYSIS: { id: "profile_pattern_analysis", category: "profile", question: "What patterns do you see in what I'm working on?", expectation: "Agent identifies themes across my intents, profile, and activity. Shows me what I'm circling around that I might not see myself.", messages: { direct_requester: "What patterns do you see in what I'm working on?", exploratory_seeker: "I feel like there's a thread connecting my work but I can't quite name it... what do you see?", technical_precise: "Identify recurring themes and patterns across my intents, profile data, and activity", vague_requester: "What am I doing exactly?" } },
  PROFILE_WEAKNESS_FEEDBACK: { id: "profile_weakness_feedback", category: "profile", question: "What looks weak or underdeveloped?", expectation: "Agent gives honest feedback on what's unclear, generic, or not well-articulated in my profile or intents.", messages: { direct_requester: "What looks weak or underdeveloped?", exploratory_seeker: "Be honest with me — what parts of my profile or intents feel generic or unclear?", technical_precise: "Critique my profile and intents for clarity, specificity, and articulation quality", vague_requester: "What's not working?" } },

  // ─── Intent Analysis ───────────────────────────────────────────────────────────
  INTENT_LIST_SIMPLE: { id: "intent_list_simple", category: "intent", question: "What intents do I have?", expectation: "Agent lists my current intents — what I'm working on, looking for, open to.", messages: { direct_requester: "What intents do I have?", exploratory_seeker: "Can you remind me what I'm currently looking for or working on?", technical_precise: "List all my active intents with their descriptions and status", vague_requester: "What do I want again?" } },
  INTENT_REMOVE_SPECIFIC: { id: "intent_remove_specific", category: "intent", question: "Remove [intent] from my profile", expectation: "Agent removes the specified intent from my profile. Confirms deletion and asks if I want to add a new one or adjust other intents to maintain discoverability.", messages: { direct_requester: "Remove my co-founder search intent", exploratory_seeker: "I don't think I need that intent about finding a co-founder anymore... can you take it off?", technical_precise: "Delete the intent 'Looking for a technical co-founder' from my profile and confirm removal", vague_requester: "Take that thing off my profile" } },
  INTENT_PREFERENCE_UPDATE: { id: "intent_preference_update", category: "intent", question: "I'm not interested in [type of opportunity] anymore", expectation: "Agent updates my preferences to filter out that type of opportunity going forward. Asks if I want to update my intents to reflect this change, or just adjust filtering. Confirms the change.", messages: { direct_requester: "I'm not interested in freelance opportunities anymore", exploratory_seeker: "I keep getting matched with freelance gigs but that's not really what I'm looking for... can we filter those out?", technical_precise: "Update my preferences to exclude freelance/contract opportunities from future matches and suggestions", vague_requester: "Stop showing me freelance stuff" } },

  // ─── Discovery & Opportunities ─────────────────────────────────────────────────
  DISCOVERY_LATEST_OPPORTUNITIES: { id: "discovery_latest_opportunities", category: "discovery", question: "What are the latest opportunities for me?", expectation: "Agent shows recent matches or potential connections that have surfaced based on my intents.", messages: { direct_requester: "What are the latest opportunities for me?", exploratory_seeker: "Has anything new come up that might be relevant to what I'm working on?", technical_precise: "Show recent opportunity matches sorted by relevance and recency based on my active intents", vague_requester: "Anything new for me?" } },
  DISCOVERY_NETWORK_SIGNALS: { id: "discovery_network_signals", category: "discovery", question: "Is there anything interesting happening around me?", expectation: "Agent surfaces signals — people, projects, or movements forming in my network that might be relevant.", messages: { direct_requester: "Is there anything interesting happening around me?", exploratory_seeker: "I feel out of the loop — what's going on in my network that I should know about?", technical_precise: "Surface recent activity signals, emerging projects, and movement patterns in my network", vague_requester: "What's going on?" } },
  DISCOVERY_RELEVANT_PEOPLE: { id: "discovery_relevant_people", category: "discovery", question: "Who is relevant to me right now?", expectation: "Agent shows people whose current work or intents align with mine. Not just generic matches, but timely ones.", messages: { direct_requester: "Who is relevant to me right now?", exploratory_seeker: "Is there anyone in the network whose work really lines up with what I'm doing at the moment?", technical_precise: "Identify people with high-relevance intent overlap based on current activity and timing", vague_requester: "Who should I know about?" } },
  DISCOVERY_EARLY_PROMISING: { id: "discovery_early_promising", category: "discovery", question: "What feels early but promising?", expectation: "Agent identifies nascent opportunities or connections that aren't obvious yet but could develop into something.", messages: { direct_requester: "What feels early but promising?", exploratory_seeker: "Are there any connections or opportunities that are just starting to form but could be interesting?", technical_precise: "Identify low-confidence but high-potential matches — nascent opportunities not yet fully developed", vague_requester: "Anything brewing?" } },
  DISCOVERY_POTENTIAL_WITH_PERSON: { id: "discovery_potential_with_person", category: "discovery", question: "What could happen between me and X?", expectation: "Agent analyzes overlap between me and a specific person, explains potential collaboration angles, and assesses if there's real opportunity.", messages: { direct_requester: "What could happen between me and Alex Chen?", exploratory_seeker: "I've been noticing Alex Chen in my network... is there something we could do together?", technical_precise: "Analyze the overlap between my profile/intents and Alex Chen's — identify collaboration angles and opportunity strength", vague_requester: "What's the deal with me and Alex?" } },
  DISCOVERY_WORTH_REACHING_OUT: { id: "discovery_worth_reaching_out", category: "discovery", question: "Is this person worth reaching out to?", expectation: "Agent gives an honest take on whether the overlap justifies reaching out, or if it's too weak/forced.", messages: { direct_requester: "Is this person worth reaching out to?", exploratory_seeker: "I saw this person's profile and they seem interesting, but should I actually reach out?", technical_precise: "Evaluate whether the intent and profile overlap with this person justifies outreach — assess strength vs forced fit", vague_requester: "Should I bother?" } },
  DISCOVERY_BUILD_WITH_KNOWN: { id: "discovery_build_with_known", category: "discovery", question: "What can I build with Seref Yarar?", expectation: "Agent identifies specific collaboration opportunities based on overlapping work, complementary skills, or shared interests.", messages: { direct_requester: "What can I build with Seref Yarar?", exploratory_seeker: "Seref seems interesting — what kind of projects could we work on together?", technical_precise: "Analyze collaboration potential with Seref Yarar based on overlapping intents, complementary skills, and shared interests", vague_requester: "What could we do together, me and Seref?" } },
  DISCOVERY_BUILD_WITH_UNKNOWN: { id: "discovery_build_with_unknown", category: "discovery", question: "What can I build with Elon Musk?", expectation: "Agent researches Elon online (recent work, current projects, stated interests, public intents), creates a profile for him, then analyzes overlap with my profile and intents. Identifies specific collaboration angles, complementary strengths, or shared problem spaces. Always should say stays private — just between me and the agent.", messages: { direct_requester: "What can I build with Elon Musk?", exploratory_seeker: "This might sound crazy, but what would a collaboration with Elon Musk even look like for someone like me?", technical_precise: "Research Elon Musk's current projects and public intents, generate a profile, then analyze overlap and collaboration potential with my profile", vague_requester: "What about me and Elon?" } },
  DISCOVERY_SHOULD_TALK: { id: "discovery_should_talk", category: "discovery", question: "Should I talk to them?", expectation: "Agent weighs the overlap, timing, and potential upside. Gives a clear yes/no/maybe with reasoning.", messages: { direct_requester: "Should I talk to them?", exploratory_seeker: "I'm on the fence about reaching out... is there enough there to make it worth it?", technical_precise: "Evaluate the overlap, timing, and potential upside of initiating contact — provide a yes/no/maybe with reasoning", vague_requester: "Worth it?" } },
  PERSON_LOOKUP_KNOWN: { id: "person_lookup_known", category: "discovery", question: "Who is Seref Yarar?", expectation: "Agent pulls up Seref's existing profile from the network, then analyzes it from my perspective — shows what he's working on, but highlights the parts that overlap with my work, where our interests align, or where there might be tension. Personalized view of who Seref is to me.", messages: { direct_requester: "Who is Seref Yarar?", exploratory_seeker: "I keep seeing Seref Yarar come up... who is he and how does his work relate to mine?", technical_precise: "Pull Seref Yarar's profile from the network and analyze it from my perspective — highlight overlaps, alignments, and tensions", vague_requester: "Tell me about Seref" } },
  PERSON_LOOKUP_UNKNOWN: { id: "person_lookup_unknown", category: "discovery", question: "Who is Elon Musk?", expectation: "Agent researches Elon online since he's not in the network, creates a profile, then analyzes it from my perspective — highlights overlap with my work, complementary strengths, potential collaboration areas, or philosophical differences. Not just facts about Elon, but what he means for me.", messages: { direct_requester: "Who is Elon Musk?", exploratory_seeker: "What do you know about Elon Musk, and how does his work connect to what I'm doing?", technical_precise: "Research Elon Musk online, generate a profile, then analyze from my perspective — overlaps, complementary strengths, collaboration potential, philosophical differences", vague_requester: "What about Elon Musk?" } },
  DISCOVERY_INTRO_KNOWN: { id: "discovery_intro_known", category: "discovery", question: "What kind of introduction would make sense for Seref?", expectation: "Agent analyzes overlap between me and Seref, then drafts a brief intro message in my writing style that explains why I'm reaching out. Includes the specific connection point and what could happen. Ready to send or edit.", messages: { direct_requester: "What kind of introduction would make sense for Seref?", exploratory_seeker: "If I were to reach out to Seref, what would I even say? Can you draft something?", technical_precise: "Analyze my overlap with Seref Yarar and draft a brief introduction message in my writing style with specific connection points", vague_requester: "Help me reach out to Seref" } },
  DISCOVERY_INTRO_UNKNOWN: { id: "discovery_intro_unknown", category: "discovery", question: "What kind of introduction would make sense for Elon Musk?", expectation: "Agent researches Elon, identifies overlap with my work, then drafts a brief intro in my writing style that explains why I'm reaching out. Includes reality check on feasibility. Ready to send or edit.", messages: { direct_requester: "What kind of introduction would make sense for Elon Musk?", exploratory_seeker: "I know it's a long shot, but if I were going to reach out to Elon Musk, what would be the best angle?", technical_precise: "Research Elon Musk, identify overlap with my work, draft an introduction message in my style with a feasibility assessment", vague_requester: "How would I even talk to Elon?" } },
  DISCOVERY_WHO_TO_MEET: { id: "discovery_who_to_meet", category: "discovery", question: "Who should I meet?", expectation: "Agent suggests 3-5 people I should meet based on my current intents and what they're working on. Not random — specific reasoning for each.", messages: { direct_requester: "Who should I meet?", exploratory_seeker: "I want to expand my network meaningfully... who should I be talking to right now?", technical_precise: "Suggest 3-5 people I should meet based on intent alignment, with specific reasoning for each recommendation", vague_requester: "Who's out there for me?" } },
  DISCOVERY_RECONNECT: { id: "discovery_reconnect", category: "discovery", question: "Who should I reconnect to in my network?", expectation: "Agent surfaces people from my existing network (Gmail, Notion, Index Chats etc.) where there's new relevance or opportunity that didn't exist before.", messages: { direct_requester: "Who should I reconnect with in my network?", exploratory_seeker: "Are there people I already know who I should be talking to again? Maybe something's changed?", technical_precise: "Analyze my existing network contacts for new relevance signals — surface people where opportunity has emerged since last contact", vague_requester: "Anyone I should catch up with?" } },
  DISCOVERY_BRIDGE_CONNECTIONS: { id: "discovery_bridge_connections", category: "discovery", question: "Who hasn't spoken to each other but should?", expectation: "Agent identifies two people in my network who have overlapping work/interests but haven't connected yet. Suggests why the intro makes sense.", messages: { direct_requester: "Who hasn't spoken to each other but should?", exploratory_seeker: "Are there people in my network who would really benefit from knowing each other but haven't connected?", technical_precise: "Identify pairs of people in my network with overlapping intents/interests who haven't connected — suggest intro rationale", vague_requester: "Anyone I should introduce to each other?" } },
  DISCOVERY_SIMILAR_DIRECTION: { id: "discovery_similar_direction", category: "discovery", question: "Who is moving in a similar direction?", expectation: "Agent finds people working on adjacent problems, similar themes, or parallel trajectories to mine.", messages: { direct_requester: "Who is moving in a similar direction?", exploratory_seeker: "I'm curious if there are people working on problems that are close to mine, even if not identical?", technical_precise: "Find people with parallel trajectories — adjacent problem spaces, similar themes, or converging work directions", vague_requester: "Anyone doing something like me?" } },
  DISCOVERY_MEET_FOR_OTHER: { id: "discovery_meet_for_other", category: "discovery", question: "Who should Seref meet?", expectation: "Agent suggests people for Seref to meet, either from my network or the broader Index network.", messages: { direct_requester: "Who should Seref meet?", exploratory_seeker: "I want to help Seref out — who in my network or on Index would be good for him to connect with?", technical_precise: "Analyze Seref Yarar's profile and intents, then suggest people from my network or the Index network he should meet", vague_requester: "Who's good for Seref?" } },
  DISCOVERY_FUNDING: { id: "discovery_funding", category: "discovery", question: "Who could fund this?", expectation: "Agent identifies potential funders, investors, or supporters based on my project/intent and their investment focus.", messages: { direct_requester: "Who could fund this?", exploratory_seeker: "I'm starting to think about fundraising... are there investors in the network who'd be interested in what I'm building?", technical_precise: "Identify potential funders or investors whose investment thesis aligns with my current project intents", vague_requester: "Where's the money?" } },
  DISCOVERY_COMPARE: { id: "discovery_compare", category: "discovery", question: "Compare me with [person]", expectation: "Agent shows side-by-side analysis of overlap and differences between me and the person — where we align, where we diverge, complementary strengths, potential collaboration areas, and potential tensions.", messages: { direct_requester: "Compare me with Sarah Chen", exploratory_seeker: "How does my profile stack up against Sarah Chen's? Where do we overlap and where do we differ?", technical_precise: "Generate a side-by-side comparison with Sarah Chen — overlaps, divergences, complementary strengths, collaboration areas, tensions", vague_requester: "How am I different from Sarah?" } },
  DISCOVERY_MUTUAL_CONNECTIONS: { id: "discovery_mutual_connections", category: "discovery", question: "Who in my network may know [person]?", expectation: "Agent searches my existing network (from Gmail, Notion, Index, etc.) to find mutual connections or people who might know the person. Shows the connection path and suggests who could make an intro.", messages: { direct_requester: "Who in my network may know Sarah Chen?", exploratory_seeker: "I want to get to Sarah Chen — does anyone in my network know her or could introduce us?", technical_precise: "Search my network sources (Gmail, Notion, Index) for mutual connections to Sarah Chen — show connection paths and intro potential", vague_requester: "Does anyone know Sarah?" } },
  DISCOVERY_SIMILAR_PEOPLE: { id: "discovery_similar_people", category: "discovery", question: "Find me more people like [person]", expectation: "Agent identifies what makes that person a good match (specific overlaps, shared interests, complementary skills), then finds others with similar profiles or working on similar things. Shows 3-5 new suggestions with reasoning.", messages: { direct_requester: "Find me more people like Sarah Chen", exploratory_seeker: "I really clicked with Sarah Chen's profile... are there others like her in the network?", technical_precise: "Analyze what makes Sarah Chen a strong match for me, then find 3-5 similar profiles based on those specific attributes", vague_requester: "More people like Sarah" } },

  // ─── Index / Community ─────────────────────────────────────────────────────────
  INDEX_MEMBERSHIP_VIEW: { id: "index_membership_view", category: "index", question: "What indexes do I belong to?", expectation: "Agent lists the communities/groups I'm part of.", messages: { direct_requester: "What indexes do I belong to?", exploratory_seeker: "Can you remind me which communities or groups I'm a member of?", technical_precise: "List all indexes where I have active membership", vague_requester: "What groups am I in?" } },
  INDEX_SHARING_VIEW: { id: "index_sharing_view", category: "index", question: "What am I sharing in this index?", expectation: "Agent shows what parts of my profile or intents are visible within a specific community.", messages: { direct_requester: "What am I sharing in the AI Founders index?", exploratory_seeker: "I'm curious — what can people in this community actually see about me?", technical_precise: "Show my visible profile data and intents within the AI Founders Network index", vague_requester: "What do they see about me in there?" } },

  // ─── Meta / System ─────────────────────────────────────────────────────────────
  META_CAPABILITIES: { id: "meta_capabilities", category: "meta", question: "How can you help?", expectation: "Agent explains what it can do for me — find people, research opportunities, manage communities, track my network.", messages: { direct_requester: "How can you help?", exploratory_seeker: "I'm still figuring out what you can do... what are the main things you can help me with?", technical_precise: "List your capabilities — discovery, profile management, community tools, network analysis, introductions", vague_requester: "What do you do?" } },
  META_HOW_INDEX_WORKS: { id: "meta_how_index_works", category: "meta", question: "How does Index work?", expectation: "Agent explains the core mechanics — how intents drive discovery, how matching happens, what stays private vs visible, and how communities factor in. Keep it simple and conversational, not technical documentation.", messages: { direct_requester: "How does Index work?", exploratory_seeker: "I'm new here — can you walk me through how this whole thing works?", technical_precise: "Explain the Index protocol mechanics — intent-driven discovery, matching algorithm, privacy model, and community structure", vague_requester: "What is this?" } },
  META_MATCHING_LOGIC: { id: "meta_matching_logic", category: "meta", question: "How do you find opportunities?", expectation: "Agent explains the matching logic — how it compares intents semantically, looks for alignment in goals/interests, considers timing and context, and surfaces people when things line up. Makes the 'magic' less mysterious.", messages: { direct_requester: "How do you find opportunities?", exploratory_seeker: "I'm curious about the matching — how do you decide who to suggest to me?", technical_precise: "Explain the semantic matching pipeline — intent comparison, goal alignment scoring, timing factors, and surfacing criteria", vague_requester: "How does matching work?" } },
  META_NO_MATCHES_DIAGNOSIS: { id: "meta_no_matches_diagnosis", category: "meta", question: "Why am I not getting matches?", expectation: "Agent diagnoses the issue — checks if intents are too vague, if profile is incomplete, if I'm in the right communities, or if there's just low activity in my problem space right now. Gives specific suggestions to improve discoverability.", messages: { direct_requester: "Why am I not getting matches?", exploratory_seeker: "I haven't been seeing many matches lately... is something wrong with my setup?", technical_precise: "Diagnose my match rate — evaluate intent specificity, profile completeness, community membership, and activity levels in my problem space", vague_requester: "Nothing's happening" } },
  META_DATA_PRIVACY: { id: "meta_data_privacy", category: "meta", question: "How is my data used?", expectation: "Agent explains what data is collected, what stays private vs visible, who can see what, how matching works without exposing everything, and how data is stored/protected. Clear privacy explanation.", messages: { direct_requester: "How is my data used?", exploratory_seeker: "I want to understand what happens with my data — who sees what, and how is it stored?", technical_precise: "Explain data collection scope, privacy model, visibility controls, matching data exposure, and storage/protection practices", vague_requester: "Is my stuff private?" } },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEED REQUIREMENTS — per-need overrides (category defaults in seed.types.ts)
// ═══════════════════════════════════════════════════════════════════════════════

export const NEED_SEED_OVERRIDES: Record<string, SeedRequirement> = {
  PROFILE_CREATE: DEFAULT_SEED_REQUIREMENTS["profile_create"],
  PROFILE_FROM_URL: DEFAULT_SEED_REQUIREMENTS["profile_create"],
  PROFILE_VIEW: DEFAULT_SEED_REQUIREMENTS["profile_view"],
  PROFILE_UPDATE: DEFAULT_SEED_REQUIREMENTS["profile_update"],
  PROFILE_UPDATE_FROM_URL: DEFAULT_SEED_REQUIREMENTS["profile_update"],
  PROFILE_SELF_VIEW: DEFAULT_SEED_REQUIREMENTS["profile_view"],
  PROFILE_SUMMARIZE: DEFAULT_SEED_REQUIREMENTS["profile_view"],
  PROFILE_REWRITE_BIO: DEFAULT_SEED_REQUIREMENTS["profile_view"],
  PROFILE_GAP_ANALYSIS: DEFAULT_SEED_REQUIREMENTS["profile_view"],
  PROFILE_PATTERN_ANALYSIS: DEFAULT_SEED_REQUIREMENTS["profile_view"],
  PROFILE_WEAKNESS_FEEDBACK: DEFAULT_SEED_REQUIREMENTS["profile_view"],
  INTENT_CREATE: DEFAULT_SEED_REQUIREMENTS["intent_create"],
  INTENT_FROM_URL: DEFAULT_SEED_REQUIREMENTS["intent_create"],
  INTENT_VIEW: DEFAULT_SEED_REQUIREMENTS["intent_view"],
  INTENT_LIST_SIMPLE: DEFAULT_SEED_REQUIREMENTS["intent_view"],
  INTENT_UPDATE: DEFAULT_SEED_REQUIREMENTS["intent_update"],
  INTENT_DELETE: DEFAULT_SEED_REQUIREMENTS["intent_delete"],
  INTENT_REMOVE_SPECIFIC: DEFAULT_SEED_REQUIREMENTS["intent_delete"],
  INTENT_PREFERENCE_UPDATE: DEFAULT_SEED_REQUIREMENTS["intent_update"],
  META_CAPABILITIES: DEFAULT_SEED_REQUIREMENTS["meta"],
  META_HOW_INDEX_WORKS: DEFAULT_SEED_REQUIREMENTS["meta"],
  META_MATCHING_LOGIC: DEFAULT_SEED_REQUIREMENTS["meta"],
  META_NO_MATCHES_DIAGNOSIS: DEFAULT_SEED_REQUIREMENTS["meta"],
  META_DATA_PRIVACY: DEFAULT_SEED_REQUIREMENTS["meta"],
  NO_ACTION_NEEDED: DEFAULT_SEED_REQUIREMENTS["meta"],
};

export function getSeedRequirements(
  category: string,
  needId?: string | null
): SeedRequirement {
  if (needId && NEED_SEED_OVERRIDES[needId]) {
    return NEED_SEED_OVERRIDES[needId];
  }
  return (
    DEFAULT_SEED_REQUIREMENTS[category] ??
    DEFAULT_SEED_REQUIREMENTS["meta"]
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO TYPE
// ═══════════════════════════════════════════════════════════════════════════════

export interface Scenario {
  id: string;
  needId: string;
  personaId: string;
  message: string;
  category: Category;
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
          : need.question;

      scenarios.push({
        id: `${needId}-${personaId}`,
        needId,
        personaId,
        message,
        category: need.category,
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
  category?: Category | "all";
}

export function filterScenarios(
  scenarios: Scenario[],
  filter: ScenarioFilter = {}
): Scenario[] {
  const { persona = "all", category = "all" } = filter;
  return scenarios.filter((s) => {
    if (persona !== "all" && s.personaId !== persona) return false;
    if (category !== "all" && s.category !== category) return false;
    return true;
  });
}

export function allCategories(): Category[] {
  return Object.values(CATEGORIES);
}

export function allPersonaIds(): UserPersonaId[] {
  return Object.keys(USER_PERSONAS) as UserPersonaId[];
}

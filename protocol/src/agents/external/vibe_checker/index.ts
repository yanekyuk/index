import { traceableLlm } from "../../../lib/agents";
import { format } from 'timeago.js';

// Type definitions
export interface VibeCheckResult {
  success: boolean;
  synthesis?: string;
  subject?: string;
  error?: string;
  timing?: { startTime: Date; endTime: Date; durationMs: number };
}

export interface VibeCheckOptions {
  timeout?: number;
  characterLimit?: number;
}

export interface IntentWithTime {
  id: string;
  payload: string;
  createdAt: Date;
}

export interface IntentPair {
  stake: number;
  contextUserIntent: IntentWithTime;
  targetUserIntent: IntentWithTime;
}

export interface OtherUserData {
  id: string;
  name: string;
  intro: string;
  intentPairs: IntentPair[];
  initiatorName?: string;
}

/**
 * Generate collaboration synthesis showing why two people are mutual matches
 * TODO: We sometimes get timeout errors here. Find out what happens.
 * @deprecated = Use SynthesisGenerator instead
 */
export async function vibeCheck(
  data: OtherUserData,
  opts: VibeCheckOptions = {}
): Promise<VibeCheckResult> {
  const startTime = new Date();

  try {
    if (!data?.intentPairs?.length) {
      return {
        success: false,
        error: 'No intent pairs provided',
        timing: getTiming(startTime)
      };
    }

    const { timeout = 30000, characterLimit } = opts;
    const isThirdPerson = !!data.initiatorName;
    const initiator = data.initiatorName || 'you';
    const target = data.name;

    // System prompt
    const systemMsg = buildSystemMessage(initiator, target, isThirdPerson, characterLimit);

    // User prompt with intent pairs
    const userMsg = buildUserMessage(data, initiator, target, isThirdPerson);


    // Execute vibe check with timeout
    /*
    const response = await Promise.race([
      traceableLlm("vibe-checker", {
        other_user_id: data.id,
        other_user_name: data.name,
        intent_pairs_count: data.intentPairs.length
      })([systemMsg, userMsg], { reasoning: { exclude: true, effort: 'minimal' }, response_format: { type: "json_object" } }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Vibe check timeout')), timeout)
      )
    ]);
    */
    const response = await traceableLlm("vibe-checker", {
      other_user_id: data.id,
      other_user_name: data.name,
      intent_pairs_count: data.intentPairs.length
    })([systemMsg, userMsg], { reasoning: { exclude: true, effort: 'minimal' }, response_format: { type: "json_object" } } as any);

    let synthesis = "";
    let subject = "";

    try {
      let contentStr = response.content as string;
      // Strip markdown code blocks if present
      contentStr = contentStr.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

      const content = JSON.parse(contentStr);
      synthesis = content.body || "";
      subject = content.subject || "";
    } catch (e) {
      // Fallback for non-JSON response (shouldn't happen with response_format)
      synthesis = (response.content as string).trim();
    }

    return {
      success: true,
      synthesis,
      subject,
      timing: getTiming(startTime)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timing: getTiming(startTime)
    };
  }
}

// Helper functions
function getTiming(startTime: Date) {
  const endTime = new Date();
  return {
    startTime,
    endTime,
    durationMs: endTime.getTime() - startTime.getTime()
  };
}

function buildSystemMessage(
  initiator: string,
  target: string,
  isThirdPerson: boolean,
  characterLimit?: number
) {
  return {
    role: "system",
    content: `You are a collaboration synthesis generator. Create a concise 1-2 sentence explanation of why two people are mutual matches based on what they're explicitly looking for.

Also generate a short, punchy title for this match.

Style for Body:
- Warm and friendly, not formal (we're introducing humans, not robots)
- Grounded in stated needs (state what they're explicitly looking for, not speculative "could do" scenarios)
- Direct and concise - exactly 1-2 sentences
- Add a small human touch—a light joke, casual aside, or relatable moment. Keep it natural, like you're telling a friend about this match.
- Clearly signal why the match works

Style for Subject (Title):
- Format: "${target} — [descriptive title]"
- Include the person's name (${target}) followed by em dash
- Stay under 12 words total
- Sound warm, professional, and action-oriented
- Avoid robotic "Label: Topic" formats (e.g., "Shared focus: AI"). Use natural phrases instead.
- Examples:
  - "${target} — Perfect match for your DeFi-focused dev needs"
  - "${target} — Strong alignment on AI research + team building"
  - "${target} — Great fit for product teams needing UI/UX depth"

Format:
- Return a JSON object with "subject" and "body" fields.
- Body Markdown with 2-3 inline hyperlinks: [descriptive phrase](https://index.network/intents/ID)
- ONLY hyperlink ${isThirdPerson ? `${initiator}'s` : 'your'} intents - NEVER link ${target}'s intents
- Be careful with IDs: use the exact intent IDs from the provided data, never use placeholder "ID" text or make up IDs
- Hyperlinks must be max 3 words (e.g., "[DeFi partnerships](link)" not "[looking for blockchain developers for new DeFi partnerships](link)")
- Link natural phrases, place links in beginning/middle of sentences, not at the end
- No bold, italic, or title${characterLimit ? `\n- Maximum ${characterLimit} characters for body` : ''}

Time Awareness:
- Each intent includes a <created> timestamp (e.g., "2 months ago", "3 days ago")
- Only mention timing when it adds meaningful value:
  - Timing contrast (fresh need meets years of experience)
  - Target's dedication (been working on this for months)
  - Urgency from target (launching soon, ready now)
- Skip mentioning ${isThirdPerson ? `${initiator}'s` : 'your'} fresh timestamps—they're noise unless creating contrast
- Use timing naturally in the flow, not as a parenthetical afterthought

Structure:
- Start with what ${initiator} ${isThirdPerson ? 'is' : 'are'} explicitly looking for
- State what ${target} provides or is looking for
- Explain the mutual fit using present tense and direct language
- Weave in timing references naturally where relevant
- Address ${isThirdPerson ? `${initiator} and ${target} in third person` : `reader as "${initiator}" vs the other person by first name only`}
- Keep it to 1-2 sentences total`
  };
}

function buildUserMessage(
  data: OtherUserData,
  initiator: string,
  target: string,
  isThirdPerson: boolean
) {
  const pairsXml = data.intentPairs
    .slice(0, 3)
    .map((pair, i) => {
      const contextLabel = isThirdPerson ? `${initiator}_intent` : 'your_intent';
      const targetLabel = `${target.toLowerCase().replace(/\s+/g, '_')}_intent`;

      return `  <pair_${i + 1}>
    <${contextLabel} id="${pair.contextUserIntent.id}">
      <what_they_want>${pair.contextUserIntent.payload}</what_they_want>
      <created>${format(pair.contextUserIntent.createdAt)}</created>
    </${contextLabel}>
    <${targetLabel} id="${pair.targetUserIntent.id}">
      <what_they_want>${pair.targetUserIntent.payload}</what_they_want>
      <created>${format(pair.targetUserIntent.createdAt)}</created>
    </${targetLabel}>
  </pair_${i + 1}>`;
    })
    .join('\n');

  const pronoun = isThirdPerson ? 'is' : 'are';
  const needs = isThirdPerson ? 'needs' : 'need';

  return {
    role: "user",
    content: `Generate collaboration synthesis between ${initiator} ${isThirdPerson ? `and ${target}` : `(authenticated user) and ${target}`}.

<other_person>
  <name>${target}</name>
  <bio>${data.intro}</bio>
</other_person>

<intent_pairs>
${pairsXml}
</intent_pairs>

Note: Use the actual <created> timestamps from the intent pairs above. The examples show timing references - yours should reflect the real data.

<examples>
  <good>
    <subject>"${target} — Perfect match for your DeFi-focused dev needs"</subject>
    <body>"You're building cross-functional product teams, and ${target} is actively looking for [blockchain developers](https://index.network/intents/ID) for new DeFi partnerships. Strong timing and a very direct talent match."</body>
  </good>
  
  <good>
    <subject>"${target} — Strong alignment on AI research + team building"</subject>
    <body>"You're assembling product teams, and ${target} is searching for [AI researchers](https://index.network/intents/ID) for ML projects. Both of you signaled these intents recently, so the alignment is fresh and relevant."</body>
  </good>
  
  <good>
    <subject>"${target} — Great fit for product teams needing UI/UX depth"</subject>
    <body>"You're focused on product development teams, and ${target} is looking to connect with [UI/UX designers](https://index.network/intents/ID). Great complement—the design talent ${target} wants is exactly what rounds out the teams you're building."</body>
  </good>
  
  <good>
    <subject>"${target} — Mentorship option to strengthen your dev teams"</subject>
    <body>"As you grow dev teams, ${target} is offering mentorship for [junior Web3 developers](https://index.network/intents/ID). A valuable add-on for building a strong foundation early."</body>
  </good>
  
  <good>
    <subject>"${target} — Exact backend expertise you're looking for"</subject>
    <body>"You need [help scaling APIs](https://index.network/intents/ID) and ${target} has scaled infrastructure at three startups. They have the exact backend expertise you're looking for."</body>
  </good>
  
  <good>
    <subject>"${target} — Visual design expertise (shockingly rare combo)"</subject>
    <body>"You want to [build better dashboards](https://index.network/intents/ID) and ${target} is obsessed with data viz. They've got the visual design expertise you're looking for (shocking how rare this combo is)."</body>
  </good>
  
  <good>
    <subject>"${target} — Theory-practice bridge for DAO governance"</subject>
    <body>"You're building [DAO governance tools](https://index.network/intents/ID) and ${target} researches token-based coordination. Your implementation focus matches their research—exactly the kind of theory-practice bridge both sides need."</body>
  </good>
  
  <good>
    <subject>"${target} — Perfect developer audience match"</subject>
    <body>"${target} runs community events for developers and you need [beta testers](https://index.network/intents/ID). They have exactly the developer audience you're trying to reach."</body>
  </good>
  
  <good>
    <subject>"${target} — Years of experience meets fresh need"</subject>
    <body>"You want [fundraising advice](https://index.network/intents/ID) and ${target} has backed 40+ startups (been investing for 5 years). You need exactly what they've spent years learning—the timing contrast actually helps here."</body>
  </good>
  
  <good>
    <subject>"${target} — Active collaboration opportunity"</subject>
    <body>"You're looking for [music collaborators](https://index.network/intents/ID) and ${target} built a collaborative music app. They're actively looking for musicians to test it with."</body>
  </good>
  
  <good>
    <subject>"${target} — Web3 gaming expertise ready to share"</subject>
    <body>"You want to [understand Web3 gaming economics](https://index.network/intents/ID) and ${target} designed token systems for three games. They're looking to advise people getting into the space—perfect fit."</body>
  </good>
  
  <good>
    <subject>"${target} — Same niche, should collaborate"</subject>
    <body>"You're researching [carbon credit verification](https://index.network/intents/ID) and ${target} is building climate impact dashboards. You both need data infrastructure—should probably just collaborate (finally, someone in the same niche)."</body>
  </good>
  
  <good>
    <subject>"${target} — Clean aesthetic you described"</subject>
    <body>"You need [visual branding](https://index.network/intents/ID) and ${target} specializes in minimal brand systems. They offer exactly the clean aesthetic you described—hard to find designers who get that less-is-more thing."</body>
  </good>
  
  <good>
    <subject>"${target} — CI/CD expertise for your pain points"</subject>
    <body>"You're [automating deployment pipelines](https://index.network/intents/ID) (been stuck on this for months) and ${target} lives in CI/CD tooling. They know the exact pain points you're hitting."</body>
  </good>
  
  <good>
    <subject>"${target} — Research question meets ready tooling"</subject>
    <body>"You want to [study market behavior](https://index.network/intents/ID) and ${target} has simulation frameworks ready to go. Perfect timing—research question meets tooling (rare to find both at once)."</body>
  </good>
  
  <good>
    <subject>"${target} — Co-founder match that actually works"</subject>
    <body>"You need a [technical co-founder](https://index.network/intents/ID) for a fintech startup and ${target} is looking for early-stage projects. Your vision matches their 5 years of backend experience—the co-founder search is brutal, this is the kind of match that actually works."</body>
  </good>
  
  <good>
    <subject>"${target} — Technical content strategy expertise"</subject>
    <body>"You need [content strategy help](https://index.network/intents/ID) and ${target} is a content strategist with 50+ clients. They specialize in technical content—exactly your domain."</body>
  </good>
  
  <good>
    <subject>"${target} — Theory-implementation loop is gold"</subject>
    <body>"You're building [treasury management tools](https://index.network/intents/ID) (been iterating for 4 months) and ${target} researches on-chain governance patterns. You're building what they've been studying—that theory-implementation loop is gold."</body>
  </good>
  
  <good>
    <subject>"${target} — Perfect speaker match (almost too obvious)"</subject>
    <body>"You're [organizing a developer conference](https://index.network/intents/ID) (happening in 2 months) and ${target} is looking for speaking gigs. Perfect match—you need speakers, they want stages (it's almost too obvious)."</body>
  </good>
  
  <good>
    <subject>"${target} — Growth playbook you need"</subject>
    <body>"You need [growth marketing tactics](https://index.network/intents/ID) and ${target} has grown 6 products from 0 to 100k users. They know the playbook you need."</body>
  </good>
  
  <good>
    <subject>"${target} — Right timing for contribution match"</subject>
    <body>"You're [building observability infrastructure](https://index.network/intents/ID) (started 6 months ago, gaining traction) and ${target} wants to contribute to monitoring tools. You want contributors, they want to contribute—timing's right for this to work."</body>
  </good>
  
  <good>
    <subject>"${target} — Scrappy builder story you need"</subject>
    <body>"You host a [podcast about makers](https://index.network/intents/ID) and are looking for guests, while ${target} just launched their third side project (now profitable). You need exactly their story—scrappy builder who actually ships."</body>
  </good>
  
  <good>
    <subject>"${target} — Impact metrics framework saves months"</subject>
    <body>"You want to [measure social impact](https://index.network/intents/ID) and ${target} has frameworks for impact metrics. They've done the hard work of figuring out what actually matters—saves you months of wandering."</body>
  </good>
</examples>`
  };
}
// ============================================================================
// NEWSLETTER SPECIFIC v1
// ============================================================================

// ============================================================================
// NEWSLETTER SPECIFIC v1
// ============================================================================

/** @deprecated */
export async function vibeCheckNewsletter(
  data: OtherUserData,
  opts: VibeCheckOptions = {}
): Promise<VibeCheckResult> {
  const startTime = new Date();

  try {
    if (!data?.intentPairs?.length) {
      return {
        success: false,
        error: 'No intent pairs provided',
        timing: getTiming(startTime)
      };
    }

    const { timeout = 30000, characterLimit } = opts;
    const isThirdPerson = !!data.initiatorName;
    const initiator = data.initiatorName || 'you';
    const target = data.name;

    // System prompt
    const systemMsg = buildNewsletterSystemMessage(initiator, target, isThirdPerson, characterLimit);
    console.log('System prompt:', systemMsg);
    // User prompt with intent pairs - Reusing the standard builder as the input data format is the same
    const userMsg = buildUserMessage(data, initiator, target, isThirdPerson);
    const response = await traceableLlm("vibe-checker", {
      other_user_id: data.id,
      other_user_name: data.name,
      intent_pairs_count: data.intentPairs.length
    })([systemMsg, userMsg], { reasoning: { exclude: true, effort: 'minimal' }, response_format: { type: "json_object" } } as any);
    let synthesis = "";
    let subject = "";

    try {
      let contentStr = response.content as string;
      // Strip markdown code blocks if present
      contentStr = contentStr.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

      const content = JSON.parse(contentStr);
      synthesis = content.body || "";
      subject = content.subject || "";
    } catch (e) {
      // Fallback for non-JSON response (shouldn't happen with response_format)
      synthesis = (response.content as string).trim();
    }

    return {
      success: true,
      synthesis,
      subject,
      timing: getTiming(startTime)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timing: getTiming(startTime)
    };
  }
}

function buildNewsletterSystemMessage(
  initiator: string,
  target: string,
  isThirdPerson: boolean,
  characterLimit?: number
) {
  return {
    role: "system",
    content: `You are a collaboration synthesis generator. Create a warm, practical explanation of why two people are mutual matches based on what they're explicitly looking for.

Also generate a descriptive title for this match.

Style for Body:
- Warm and friendly, not formal
- Single, short, punchy sentence explanation (maximum 2 lines)
- Grounded in stated needs
- Direct and concise
- Add a small human touch
- Titles should clearly signal why the match works

Style for Subject (Title):
- DO NOT include the person's name in the title
- Highlight strongest mutual-intent synergy
- Stay under 12 words
- Sound warm, professional, and action-oriented
- Avoid robotic "Label: Topic" formats
- Examples:
  - "Perfect match for your DeFi-focused dev needs"
  - "Strong alignment on AI research + team building"
  - "Deep synergy on protocol scaling"

Format:
- Return a JSON object with "subject" and "body" fields.
- "subject" is the Title. "body" is the explanation.
- Body Markdown: ${isThirdPerson ? 'Mention' : 'You can mention'} intents but DO NOT use hyperlinks. Just use the text.
- IMPORTANT: The body must be a SINGLE SENTENCE (or two short ones). No multiple paragraphs.
- IMPORTANT: Do NOT use any XML tags like <your_intent> in the response.
- Do not place links anywhere - hyperlinks are prohibited in this format
- No bold, italic, or title${characterLimit ? `\n- Maximum ${characterLimit} characters for body` : ''}

Time Awareness:
- Each intent includes a <created> timestamp (e.g., "2 months ago", "3 days ago")
- Only mention timing when it adds meaningful value:
  - Timing contrast (fresh need meets years of experience)
  - Target's dedication (been working on this for months)
  - Urgency from target (launching soon, ready now)
- Skip mentioning ${isThirdPerson ? `${initiator}'s` : 'your'} fresh timestamps—they're noise unless creating contrast
- Use timing naturally in the flow, not as a parenthetical afterthought

Structure:
- State what ${target} provides or is looking for
- Explain the mutual fit using present tense and direct language
- Weave in timing references naturally where relevant
- Address ${isThirdPerson ? `${initiator} and ${target} in third person` : `reader as "${initiator}" vs the other person by first name only`}`
  };
}

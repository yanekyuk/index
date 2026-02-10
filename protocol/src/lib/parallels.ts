import { log } from './log';
import Parallel from 'parallel-web';

const logger = log.lib.from("lib/parallels.ts");
const PARALLELS_API_KEY = process.env.PARALLELS_API_KEY || '';

// Initialize Parallel client
const parallelClient = new Parallel({
  apiKey: PARALLELS_API_KEY,
});



export async function extractUrlContent(url: string): Promise<string | null> {
  if (!PARALLELS_API_KEY) {
    throw new Error('PARALLELS_API_KEY not configured');
  }

  try {
    logger.info('Extracting URL content', { url });
    
    const extract = await parallelClient.beta.extract({
      urls: [url],
      excerpts: true,
      full_content: true,
      objective: 'all',
      fetch_policy: {
        disable_cache_fallback: false,
        max_age_seconds: 5184000, // 60 days
        timeout_seconds: 30,
      },
    });
    
    logger.info('Parallel extract response received', { url, resultsCount: extract.results?.length || 0 });
    
    if (extract.results && extract.results.length > 0) {
      const result = extract.results[0];
      // Access content from result - check common property names
      const content = (result as any).content || (result as any).excerpts?.[0] || (result as any).excerpt || (result as any).markdown || null;
      logger.info('Extracted content', { url, contentLength: content?.length || 0, resultKeys: Object.keys(result) });
      return content;
    }

    logger.warn('No results in extract response', { url, extract });
    return null;
  } catch (error) {
    const errorDetails = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack,
    } : { error };
    logger.error('Failed to extract URL content', { url, error: errorDetails });
    return null;
  }
}

export interface GenerateIntroInput {
  email?: string;
  linkedin?: string;
  twitter?: string;
  name?: string;
}

export interface GenerateIntroOutput {
  intro: string | null;
  location: string | null;
  biography: string | null;
}

export interface GenerateSummaryInput {
  name?: string;
  email?: string;
  linkedin_url?: string;
  twitter_url?: string;
}

export interface GeneratedIntent {
  intent: string;
  confidence: 'low' | 'medium' | 'high';
  date: string;
}

export interface GenerateSummaryOutput {
  intro: string | null;
  location: string | null;
  intents: GeneratedIntent[];
}

export interface SummaryStreamEvent {
  type: 'status' | 'progress' | 'result' | 'error';
  message?: string;
  data?: GenerateSummaryOutput;
}


/**
 * Generate summary with intro, location, and intents using Parallel AI
 * Streams events via callback for real-time updates
 */
export async function generateSummaryWithIntents(
  input: GenerateSummaryInput,
  onEvent?: (event: SummaryStreamEvent) => void
): Promise<GenerateSummaryOutput | null> {
  if (!PARALLELS_API_KEY) {
    throw new Error('PARALLELS_API_KEY not configured');
  }

  try {
    // Build input object
    const cleanedInput: Record<string, string> = {};
    
    if (input.name?.trim()) {
      cleanedInput.name = input.name.trim();
    }
    
    if (input.email?.trim()) {
      cleanedInput.email = input.email.trim();
    }
    
    if (input.linkedin_url?.trim()) {
      cleanedInput.linkedin_url = input.linkedin_url.trim();
    }
    
    if (input.twitter_url?.trim()) {
      cleanedInput.twitter_url = input.twitter_url.trim();
    }
    
    if (Object.keys(cleanedInput).length === 0) {
      logger.error('No valid fields provided to generateSummaryWithIntents', { input });
      onEvent?.({ type: 'error', message: 'Hmm, I need something to work with. Could you share your name, email, or a profile link?' });
      return null;
    }

    logger.info('Starting summary generation', { fields: Object.keys(cleanedInput) });
    onEvent?.({ type: 'status', message: 'Let me get to know you...' });

    // Create task with events enabled using beta API
    const taskRun = await parallelClient.beta.taskRun.create({
      input: cleanedInput,
      processor: 'core-fast',
      enable_events: true,
      betas: ['events-sse-2025-07-24'],
      task_spec: {
        input_schema: {
          json_schema: {
            properties: {
              email: {
                description: 'The email address of the person to analyze for intents.',
                type: 'string',
              },
              linkedin_url: {
                description: 'The LinkedIn profile URL of the person to analyze for intents.',
                type: 'string',
              },
              name: {
                description: 'The name of the person to analyze for intents.',
                type: 'string',
              },
              twitter_url: {
                description: 'The Twitter profile URL of the person to analyze for intents.',
                type: 'string',
              },
            },
            type: 'object',
          },
          type: 'json',
        },
        output_schema: {
          json_schema: {
            additionalProperties: false,
            properties: {
              intro: {
                description: `A short introduction in a clear, warm, lightly playful style, following the tone and structure demonstrated in the few-shot examples below.

Requirements:
- no first-person  
- no third-person  
- no “I / me / my” or “he / she / they / name”  
- upbeat but not cheesy  
- clean, human, lightly happy  
- 2–4 sentences  
- 45–90 words  
- focuses on origins/background → areas of work → interests → current focus  
- no emojis  
- no hype  
- no bullet points in the **output intro**  
- output only the intro, nothing else  

Style Targets:
- light warmth  
- reflective, curious tone  
- slightly playful but still professional  
- introduction written about someone without referring to them directly  

Few-Shot Examples

**Example 1**  
Rooted in curiosity for how people organize, with a background in systems research and community tooling. Drawn to cooperative structures, lightweight governance, and the quiet signals that help groups understand each other. Currently exploring neighborhood-scale coordination with an open, hopeful spirit.

**Example 2**  
Shaped by years in distributed systems and cryptography, with work spanning secure tools and open communities. Interests orbit around privacy, identity, and trust in messy, real-world environments. Now experimenting with intent-sharing models that protect the humans behind the data while keeping collaboration joyful.

**Example 3**  
Blends storytelling, design, and community education into a single thread focused on helping groups convey what matters. Energized by participatory processes and narrative-driven decision-making. Currently developing tools that nurture shared meaning and healthier digital spaces.

**Example 4**  
Starting from mathematics and machine learning research, with a growing fascination for small agent ecosystems and emergent behavior. Passion lies in understanding how attention, incentives, and coordination shape complex networks. Now exploring playful experiments where autonomous agents learn from each other in constrained environments.

**Example 5**  
Grounded in civic tech and cooperative product design, with experience building tools that support collective action. Drawn to long-term trust, resource pooling, and structures that let communities govern themselves. Focus now rests on models for shared digital stewardship and smoother group coordination.

If insufficient information, return 'Intro unavailable'`,
                type: 'string',
              },
              location: {
                description: 'The primary geographical location (city, state, or country) associated with the individual. If cannot be determined, return "Location unavailable".',
                type: 'string',
              },
              intents: {
                description: `You extract social intents from content.

Rules:
1. Intents must be substantial and meaningful, not procedural calls-to-action
2. Remove temporal markers ("Now", "Currently", "Just") - focus on the actual intent
3. Skip generic instructions ("fill out form", "apply here", "contact us", "pass it along")
4. Combine related technical requirements into cohesive intents, not fragmented lists
5. Forward-looking (what they seek/offer), not backward-looking (what they've done)
6. Intents MUST be self-contained with enough context to be understood independently
7. Add relevant context from surrounding content to make intents substantial

EXPLICIT (directly stated) → preserve core statement but add relevant context to make it self-contained

IMPLICIT (inferred) → convey through topic/direction in source tone, not as role-seeking

Examples:

Content: "Looking for Rust devs. Been thinking about privacy-preserving computation."

✅ "Looking for Rust devs to work on privacy-preserving computation" (explicit, self-contained)

✅ "Thinking about privacy-preserving computation" (implicit)

❌ "Looking for Rust devs" (too short, not self-contained)

❌ "Seeking collaborators in privacy tech" (constructed role)

Content: "PhD on climate models. The question is making them accessible to smaller groups."

✅ "Figuring out how to make climate models accessible" (implicit, in source tone)

✅ "Working on climate modeling approaches" (implicit)

❌ "Looking for research partners" (constructed role)

❌ "Seeking collaboration opportunities" (constructed role)

Content: "Now looking for a founding engineer. Fill out the form if interested."

✅ "Looking for a founding engineer" (explicit, temporal marker removed, but needs more context if available)

❌ "Fill out the form if interested" (procedural call-to-action)

❌ "Now looking for a founding engineer" (keep temporal marker)

Content: "Looking for Founding Fullstack Engineer to build protocol for private, intent-driven discovery. Apply here."

✅ "Looking for Founding Fullstack Engineer to build protocol for private, intent-driven discovery" (explicit, self-contained)

❌ "Looking for Founding Fullstack Engineer" (too short, not self-contained)

❌ "Apply here" (procedural call-to-action)

Content: "Been playing with agent coordination. Not sure anyone's solved the game theory."

✅ "Playing with agent coordination mechanisms" (implicit, keeps casual tone)

✅ "Figuring out game theory for agent systems" (implicit)

❌ "Need game theory experts" (constructed role)

❌ "Seeking technical advisors" (constructed role)

Content: "Building tools for decentralized research. The hard part is incentive alignment."

✅ "Building tools for decentralized research" (implicit)

✅ "Figuring out incentive alignment for research networks" (implicit)

❌ "Looking for partners in research infrastructure" (constructed role)

Content: "Job posting: Need experience with Next.js, React, TypeScript, Postgres, Redis, Docker."

✅ "Looking for fullstack engineering experience (Next.js, React, TypeScript, Postgres, Redis)" (cohesive)

❌ "Need experience with Next.js" (fragmented)

❌ "Need experience with React" (fragmented)

❌ "Need experience with TypeScript" (fragmented)

Content: "Exploring how privacy and discovery can coexist. Interested in agent-native protocols."

✅ "Exploring how privacy and discovery can coexist" (implicit, as stated)

✅ "Interested in agent-native protocols" (implicit)

❌ "Seeking privacy researchers" (constructed role)

Content: "Open to consulting in distributed systems. Working on consensus mechanisms."

✅ "Open to consulting in distributed systems" (explicit)

✅ "Working on consensus mechanisms" (implicit)

❌ "Looking for consulting opportunities" (rephrased explicit wrong)

Content: "Trying to understand how trust emerges in P2P networks. No clear answer yet."

✅ "Trying to understand how trust emerges in P2P networks" (implicit, keeps exploratory tone)

✅ "Exploring trust models without central authority" (implicit)

❌ "Seeking P2P networking experts" (constructed role)

Pattern: 

- Explicit → preserve exactly, remove temporal markers
- Implicit → what they're doing/exploring, not who they're seeking
- Skip procedural instructions and calls-to-action
- Combine related items into cohesive intents
- Keep the voice: casual stays casual, technical stays technical, exploratory stays exploratory

Generate intents naturally, you decide how many intents to generate (typically 3-10).`,
                items: {
                  additionalProperties: false,
                  properties: {
                    confidence: {
                      description: 'The confidence level that this intent accurately represents the user\'s current activity or goals. Use "high" for explicit intents, "medium" for well-supported implicit intents, and "low" for inferred intents with less evidence.',
                      enum: ['low', 'medium', 'high'],
                      type: 'string',
                    },
                    date: {
                      description: 'The date on which the user is observed or inferred to currently have this intent.',
                      type: 'string',
                    },
                    intent: {
                      description: 'Substantial, self-contained social intent following all the rules above. Must be meaningful, forward-looking, and contain enough context to stand alone.',
                      type: 'string',
                    },
                  },
                  required: ['date', 'confidence', 'intent'],
                  type: 'object',
                },
                type: 'array',
              },
            },
            required: ['intro', 'location', 'intents'],
            type: 'object',
          },
          type: 'json',
        },
      },
    });

    logger.info('Task created', { runId: taskRun.run_id });
    onEvent?.({ type: 'status', message: 'Reading about you...' });

    // Stream events using SDK with simplified event handling
    const eventStream = await parallelClient.beta.taskRun.events(taskRun.run_id);
    let finalResult: GenerateSummaryOutput | null = null;
    let hasCompleted = false;
    
    // Collect links and batch them
    const allLinks: Set<string> = new Set();
    let linksProcessedCount = 0;
    let inFinalStages = false;
    
    // Final stage messages - more human and quirky
    const finalStages = [
      'Figuring out where you\'re based...',
      'Crafting your story...',
      'Reading between the lines...',
      'Making sure I got it right...',
    ];
    
    // Varied link collection messages
    const linkMessages = [
      (count: number, total: number) => `Found ${count} interesting things about you...`,
      (count: number, total: number) => `Reading through ${count} profiles...`,
      (count: number, total: number) => `Checking out ${count} links...`,
      (count: number, total: number) => `Scanned ${count} sources so far...`,
      (count: number, total: number) => `Going through ${count} pages about you...`,
    ];
    let linkMessageIndex = 0;
    let finalStageIndex = 0;

    // Timer for batching links (every 2 seconds)
    const linkBatchInterval = setInterval(() => {
      if (!inFinalStages && allLinks.size > linksProcessedCount) {
        const batchSize = 10;
        const linksArray = Array.from(allLinks);
        const batch = linksArray.slice(linksProcessedCount, linksProcessedCount + batchSize);
        
        if (batch.length > 0) {
          linksProcessedCount += batch.length;
          // Rotate through different message styles
          const messageFn = linkMessages[linkMessageIndex % linkMessages.length];
          linkMessageIndex++;
          onEvent?.({
            type: 'progress',
            message: messageFn(linksProcessedCount, allLinks.size),
          });
        }
      }
    }, 2000);

    // Timer for final stage updates (every 3 seconds)
    const finalStageInterval = setInterval(() => {
      if (inFinalStages && finalStageIndex < finalStages.length) {
        onEvent?.({ type: 'progress', message: finalStages[finalStageIndex] });
        finalStageIndex++;
      }
    }, 3000);

    try {
      for await (const event of eventStream) {
        if (event.type === 'task_run.state') {
          const status = event.run.status;
          if (status === 'completed') {
            hasCompleted = true;
            clearInterval(linkBatchInterval);
            clearInterval(finalStageInterval);
            if (event.output) {
              const output = event.output as any;
              const content = output.content || output;
              
              const intro = content.intro && 
                            content.intro !== 'Intro unavailable' && 
                            content.intro.trim() !== '' ? content.intro : null;
              
              const location = content.location && 
                               content.location !== 'Location unavailable' && 
                               content.location.trim() !== '' ? content.location : null;
              
              const intents: GeneratedIntent[] = (content.intents || []).map((i: any) => ({
                intent: i.intent,
                confidence: i.confidence || 'medium',
                date: i.date || new Date().toISOString().split('T')[0],
              }));

              finalResult = { intro, location, intents };
              onEvent?.({ type: 'result', data: finalResult });
            }
          } else if (status === 'failed' || status === 'cancelled') {
            hasCompleted = true;
            clearInterval(linkBatchInterval);
            clearInterval(finalStageInterval);
            const errorMsg = event.run.error?.message || 'Something went wrong while researching you. Mind trying again?';
            onEvent?.({ type: 'error', message: errorMsg });
            return null;
          }
        } else if (event.type === 'task_run.progress_stats') {
          // Collect links from source stats
          if (event.source_stats.sources_read_sample) {
            for (const link of event.source_stats.sources_read_sample) {
              allLinks.add(link);
            }
          }
          
          // Transition to final stages when progress > 50%
          if (event.progress_meter > 50 && !inFinalStages) {
            inFinalStages = true;
            finalStageIndex = 0;
          }
        } else if (event.type === 'error') {
          hasCompleted = true;
          clearInterval(linkBatchInterval);
          clearInterval(finalStageInterval);
          const errorMsg = event.error?.message || 'Oops, hit a snag. Let me try that again...';
          onEvent?.({ type: 'error', message: errorMsg });
          return null;
        }
      }
      
      clearInterval(linkBatchInterval);
      clearInterval(finalStageInterval);
    } catch (streamError: any) {
      clearInterval(linkBatchInterval);
      clearInterval(finalStageInterval);
      logger.error('Error streaming events', { error: streamError.message });
      // Fallback to result endpoint if streaming fails
      if (!hasCompleted) {
        try {
          const result = await parallelClient.beta.taskRun.result(taskRun.run_id, {
            betas: ['events-sse-2025-07-24'],
          });
          
          if (result?.output) {
            const output = result.output as any;
            const content = output.content || output;
            
            const intro = content.intro && 
                          content.intro !== 'Intro unavailable' && 
                          content.intro.trim() !== '' ? content.intro : null;
            
            const location = content.location && 
                             content.location !== 'Location unavailable' && 
                             content.location.trim() !== '' ? content.location : null;
            
            const intents: GeneratedIntent[] = (content.intents || []).map((i: any) => ({
              intent: i.intent,
              confidence: i.confidence || 'medium',
              date: i.date || new Date().toISOString().split('T')[0],
            }));

            finalResult = { intro, location, intents };
            onEvent?.({ type: 'result', data: finalResult });
            return finalResult;
          }
        } catch (resultError: any) {
          logger.error('Failed to get result after stream error', { error: resultError.message });
          onEvent?.({ type: 'error', message: resultError.message || 'Had trouble finishing up. Could you try again?' });
          return null;
        }
      }
      throw streamError;
    }

    logger.info('Task completed', { runId: taskRun.run_id, hasResult: !!finalResult });

    if (finalResult) {
      return finalResult;
    }

    onEvent?.({ type: 'error', message: 'Hmm, I couldn\'t find enough info to create your profile. Mind sharing a bit more?' });
    return null;
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('Failed to generate summary', { error: errorMessage });
    onEvent?.({ type: 'error', message: errorMessage });
    return null;
  }
}

// Export the parallel client for direct access if needed
export { parallelClient };


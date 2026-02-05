# Intent Enrichment Approaches

## Problem Statement

When users create intents that reference their projects, documents, or other contextual entities, the generated intent descriptions often contain **opaque proper nouns** that are meaningless to potential matches.

### Examples Across Domains

The problem manifests across many intent types:

| Domain | Bad Intent (Opaque) | Good Intent (Concept-Rich) |
|--------|---------------------|---------------------------|
| Hiring | "Hire developers for my Acme project" | "Seeking developers with React, Node.js, and AWS experience for a B2B SaaS platform" |
| Co-founders | "Looking for a co-founder for my startup" | "Seeking technical co-founder with fintech experience and payment processing knowledge" |
| Investment | "Looking for investors for our Series A" | "Seeking Series A investors interested in AI-powered healthcare diagnostics" |
| Customers | "Looking for customers for my product" | "Seeking enterprise manufacturing companies needing predictive maintenance solutions" |
| Partnerships | "Want to partner with companies like ours" | "Seeking e-commerce platform partnerships for logistics API integration" |
| Learning | "I want to learn about what was discussed" | "Learn distributed systems and consensus algorithms for blockchain development" |
| Mentorship | "Need advice on my business" | "Seeking mentorship on scaling a developer tools SaaS from $1M to $10M ARR" |
| Research | "Looking for research collaborators" | "Seeking collaborators for NLP research on LLM alignment and RLHF techniques" |
| Creative | "Need help with my content" | "Seeking video editors experienced in YouTube long-form content and motion graphics" |

**The core issue**: Opaque references (project names, "my startup", "our company") mean nothing to potential matches. The actual matching criteria are the **technologies, skills, industries, and domains** that should be explicitly stated.

---

## Solution Approaches

### Option 1: Prompt Engineering (Implemented)

**Status**: ✅ Implemented in `explicit.inferrer.ts`

**Approach**: Modify the `ExplicitIntentInferrer` system prompt to explicitly instruct:
- Never use project names, company names, or proper nouns that require context
- Extract underlying concepts: technologies, skills, domains
- Make intents self-contained and understandable to strangers

**Pros**:
- Zero additional latency
- Zero additional cost
- Simple to maintain

**Cons**:
- Relies on LLM following instructions consistently
- May miss edge cases where context isn't in the immediate input

**When to use**: First line of defense. Should handle ~80% of cases.

---

### Option 2: Pre-extraction (Structured Concept Metadata)

**Status**: 🔮 Future consideration

**Approach**: When a document is uploaded/processed, extract key concepts as structured metadata and store them alongside the document.

```typescript
interface DocumentConcepts {
  technologies: string[];      // ["LangGraph", "PostgreSQL", "TypeScript"]
  domains: string[];           // ["AI agents", "semantic search"]
  skills: string[];            // ["distributed systems", "LLM orchestration"]
  problemAreas: string[];      // ["intent matching", "profile generation"]
}
```

When the intent inferrer runs:
1. Check if the input references a known document
2. Load the document's concept metadata
3. Pass concepts explicitly to the inferrer as structured data

**Pros**:
- Concepts are extracted once, reused many times
- Structured data is more reliable than LLM extraction each time
- Can be reviewed/edited by users

**Cons**:
- Requires schema changes to store concepts
- Requires concept extraction pipeline (another LLM call at upload time)
- Needs reference detection ("this project" → which document?)

**Implementation sketch**:

```typescript
// At document upload time
const concepts = await conceptExtractor.extract(documentContent);
await db.update(files).set({ concepts }).where(eq(files.id, fileId));

// At intent inference time
const inferrerInput = {
  content: userMessage,
  documentConcepts: file.concepts,  // Pass structured concepts
  profileContext: userProfile
};
```

---

### Option 3: Post-processing Entity Resolution

**Status**: 🔮 Future consideration

**Approach**: Run generated intents through an "enrichment" agent that:
1. Detects opaque entities (project names, "my X", company names)
2. Resolves them against available context (documents, conversation history)
3. Replaces/expands with concrete concepts

```typescript
interface EntityResolution {
  originalPhrase: string;       // "Index Network project"
  resolvedConcepts: string[];   // ["LangGraph-based", "AI agent system", ...]
  confidenceScore: number;
  contextSource: string;        // "file:claude-md-uuid"
}

class IntentEnricher {
  async enrich(intent: string, availableContext: Context[]): Promise<string> {
    // 1. Identify opaque entities
    const entities = await this.detectOpaqueEntities(intent);
    
    // 2. For each entity, find relevant context
    for (const entity of entities) {
      const context = await this.findContext(entity, availableContext);
      if (context) {
        const concepts = await this.extractConcepts(context);
        intent = this.replaceEntity(intent, entity, concepts);
      }
    }
    
    return intent;
  }
}
```

**Pros**:
- Most robust for complex reference resolution
- Works for references to past conversations, not just current document
- Can handle "my startup" → look up user's company profile

**Cons**:
- Additional LLM call per intent (latency + cost)
- Requires maintaining context registry (what context is available for resolution)
- More complex to implement and debug

**When to use**: Reserve for cases where:
- Intent references context not in immediate input
- User's history needs to be considered
- High-value matching scenarios where accuracy matters more than latency

---

## Implementation Roadmap

### Phase 1: Prompt Engineering (Current)
- ✅ Updated `ExplicitIntentInferrer` system prompt
- Monitor intent quality in production
- Collect failure cases where proper nouns slip through

### Phase 2: Pre-extraction (If needed)
- Add `concepts` column to files table
- Create `ConceptExtractor` agent
- Extract concepts at upload time
- Pass concepts to inferrer

### Phase 3: Post-processing (If needed)
- Build `IntentEnricher` agent
- Create context registry (files, conversations, integrations)
- Add as optional post-processing step for high-value intents

---

## Testing Strategy

### Unit Tests
```typescript
describe('ExplicitIntentInferrer - Concept Extraction', () => {
  
  // Tech/Hiring domain
  it('should extract tech stack instead of project name', async () => {
    const content = `
      Project uses LangGraph for agent orchestration,
      PostgreSQL with pgvector for semantic search,
      and BullMQ for job queues.
    `;
    
    const result = await inferrer.invoke(
      "I want to hire developers for this project",
      content
    );
    
    expect(result.intents[0].description).not.toContain('this project');
    expect(result.intents[0].description).toMatch(/LangGraph|PostgreSQL|BullMQ/);
  });
  
  // Startup/Co-founder domain
  it('should extract domain expertise instead of "my startup"', async () => {
    const content = "We're building an AI-powered code review tool for enterprise teams";
    
    const result = await inferrer.invoke(
      "Looking for a co-founder for my startup",
      content
    );
    
    expect(result.intents[0].description).not.toContain('my startup');
    expect(result.intents[0].description).toMatch(/AI|code review|enterprise/i);
  });
  
  // Investment domain
  it('should extract industry and stage instead of company name', async () => {
    const content = "HealthTech startup using ML for early cancer detection from radiology images";
    
    const result = await inferrer.invoke(
      "Looking for Series A investors for TechCorp",
      content
    );
    
    expect(result.intents[0].description).not.toContain('TechCorp');
    expect(result.intents[0].description).toMatch(/healthcare|medical|ML|radiology|Series A/i);
  });
  
  // B2B/Sales domain
  it('should extract customer profile instead of "my product"', async () => {
    const content = "IoT platform for predictive maintenance in manufacturing plants";
    
    const result = await inferrer.invoke(
      "Looking for customers for my product",
      content
    );
    
    expect(result.intents[0].description).not.toContain('my product');
    expect(result.intents[0].description).toMatch(/manufacturing|IoT|predictive maintenance/i);
  });
  
  // Education/Learning domain
  it('should extract specific topics instead of vague references', async () => {
    const content = "Discussion covered Kubernetes operators, service mesh patterns, and GitOps workflows";
    
    const result = await inferrer.invoke(
      "I want to learn more about what we discussed",
      content
    );
    
    expect(result.intents[0].description).not.toContain('what we discussed');
    expect(result.intents[0].description).toMatch(/Kubernetes|service mesh|GitOps/i);
  });
  
  // Creative domain
  it('should extract creative skills instead of "my content"', async () => {
    const content = "YouTube channel focused on tech reviews with cinematic B-roll and animations";
    
    const result = await inferrer.invoke(
      "Need help with my content",
      content
    );
    
    expect(result.intents[0].description).not.toContain('my content');
    expect(result.intents[0].description).toMatch(/video|YouTube|animation|cinematic/i);
  });
});
```

### Integration Tests
- Upload document with known tech stack
- Create intent referencing that document
- Verify intent contains concepts, not project name

---

## Metrics to Track

1. **Opaque entity rate**: % of intents containing project names / "my X" / etc.
2. **Concept extraction rate**: % of intents that successfully extract technologies/domains
3. **Match quality**: Do enriched intents lead to better matches?
4. **User edits**: How often do users manually edit generated intents?

# Profile Graph Usage Guide

Quick reference for using the refactored Profile Graph in your code.

## Basic Usage

### 1. Query Existing Profile (Fast Path)

Use when you just want to retrieve an existing profile without any generation.

```typescript
import { ProfileGraphFactory } from './graphs/profile/profile.graph';

const factory = new ProfileGraphFactory(database, embedder, scraper);
const graph = factory.createGraph();

const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'query'  // Read-only, no generation
});

// Result:
// {
//   profile: { ... } | undefined,  // Existing profile or undefined if not found
//   needsProfileGeneration: false,
//   needsProfileEmbedding: false,
//   needsHydeGeneration: false,
//   needsHydeEmbedding: false
// }
```

**When to use**:
- Displaying user profile
- Profile lookup for matching
- Any read-only operation

**Performance**: ~100ms, 1 DB query

---

### 2. Generate New Profile from Input

Use when you have user data and want to generate a complete profile.

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write',
  input: 'User bio, skills, interests, etc.'
});

// Result:
// {
//   profile: { identity, narrative, attributes, embedding, hydeDescription, hydeEmbedding },
//   hydeDescription: "...",
//   needsProfileGeneration: true,
//   needsProfileEmbedding: false,
//   needsHydeGeneration: true,
//   needsHydeEmbedding: false
// }
```

**When to use**:
- User onboarding
- Manual profile creation
- Importing user data

**Performance**: ~10-15s, 2 LLM calls + 2 embeddings

---

### 3. Generate Profile with Web Scraping

Use when you don't have input data and want to scrape user information from the web.

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write'
  // No input - will scrape based on user's email and socials
});

// Graph will:
// 1. Fetch user details from DB (email, socials)
// 2. Call scraper with constructed objective
// 3. Generate profile from scraped data
// 4. Generate embeddings
// 5. Generate hyde and its embedding
```

**When to use**:
- Automatic profile enrichment
- Background profile generation
- User has minimal onboarding data

**Performance**: ~15-20s, 1 scrape + 2 LLM calls + 2 embeddings

---

### 4. Update Existing Profile

Use when you want to update an existing profile with new information.

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write',
  forceUpdate: true,
  input: 'New skills: Python, Machine Learning. New interest: AI Research.'
});

// Graph will:
// 1. Load existing profile
// 2. Merge new information with existing profile
// 3. Regenerate profile embedding
// 4. Auto-regenerate hyde (because profile changed)
// 5. Regenerate hyde embedding
```

**When to use**:
- User updates their profile
- Adding new skills/interests
- Refreshing profile data

**Performance**: ~10-15s, 2 LLM calls + 2 embeddings

---

### 5. Fix Missing Components

Use when profile exists but some components are missing (embeddings, hyde).

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write'
});

// Graph will automatically detect and generate only what's missing:
// - Profile exists but no embedding? Generate embedding only
// - Profile & embedding exist but no hyde? Generate hyde only
// - Hyde exists but no embedding? Generate hyde embedding only
```

**When to use**:
- Recovery from partial failures
- Migration/backfill operations
- Fixing incomplete profiles

**Performance**: Varies based on what's missing (1-5s)

---

## Advanced Usage

### Conditional Execution

The graph automatically routes based on what's needed:

```typescript
// Example: Profile exists with embedding, but hyde is missing
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write'
});

// Graph will:
// 1. check_state: Detect hyde is missing
// 2. Skip to generate_hyde
// 3. embed_save_hyde
// 4. END
//
// Skips: scrape, generate_profile, embed_save_profile
// Saves: ~7-10s and 1 LLM call
```

### Error Handling

The graph returns errors in state rather than throwing:

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write'
});

if (result.error) {
  console.error('Profile generation failed:', result.error);
  // Handle error gracefully
}
```

### Integration with Chat Graph

The chat graph automatically uses the correct operation mode:

```typescript
// In chat.graph.ts

// Fast path for profile queries
const profileQueryNode = async (state) => {
  return await profileGraph.invoke({
    userId: state.userId,
    operationMode: 'query'  // Read-only
  });
};

// Full pipeline for profile updates
const profileSubgraphNode = async (state) => {
  return await profileGraph.invoke({
    userId: state.userId,
    operationMode: 'write',  // Conditional generation
    forceUpdate: hasNewData,
    input: extractedContext
  });
};
```

---

## Common Patterns

### Pattern 1: Create or Update

```typescript
async function ensureProfileExists(userId: string, input?: string) {
  const graph = factory.createGraph();
  
  return await graph.invoke({
    userId,
    operationMode: 'write',
    input,
    forceUpdate: !!input  // Update if input provided
  });
}
```

### Pattern 2: Check Profile Completeness

```typescript
async function isProfileComplete(userId: string) {
  const graph = factory.createGraph();
  
  const result = await graph.invoke({
    userId,
    operationMode: 'query'
  });
  
  if (!result.profile) return false;
  
  const profile = result.profile as any;
  return !!(
    profile.embedding?.length &&
    profile.hydeDescription &&
    profile.hydeEmbedding?.length
  );
}
```

### Pattern 3: Batch Profile Generation

```typescript
async function generateProfilesInBatch(userIds: string[]) {
  const graph = factory.createGraph();
  
  const results = await Promise.all(
    userIds.map(userId => 
      graph.invoke({
        userId,
        operationMode: 'write'
      })
    )
  );
  
  return results;
}
```

### Pattern 4: Incremental Enrichment

```typescript
async function enrichProfileWithScrapedData(userId: string) {
  const graph = factory.createGraph();
  
  // First check if profile exists
  const existing = await graph.invoke({
    userId,
    operationMode: 'query'
  });
  
  if (!existing.profile) {
    // Generate new profile with scraping
    return await graph.invoke({
      userId,
      operationMode: 'write'
      // No input - will scrape
    });
  } else {
    // Profile exists, scrape and merge
    // (You'd need to call scraper separately or add a scrape flag)
    return existing;
  }
}
```

---

## Decision Tree

```
Need to use Profile Graph?
│
├─ Just reading profile? ──> operationMode: 'query'
│
├─ Creating new profile?
│   ├─ Have input data? ──> operationMode: 'write' + input
│   └─ No input data? ──> operationMode: 'write'
│       └─ Graph checks if user info sufficient
│           ├─ Sufficient? ──> Scrapes web
│           └─ Insufficient? ──> Returns needsUserInfo flag
│
├─ Updating existing profile? ──> operationMode: 'write' + forceUpdate: true + input
│
└─ Fixing incomplete profile? ──> operationMode: 'write' (auto-detects missing parts)
```

---

## User Information Detection

### Overview

When generating a new profile without input, the graph validates that sufficient user information exists for accurate web scraping. Without proper identifiers (social URLs or full name), the scraper might find the wrong person.

### What Information is Needed?

**Minimum Requirements** (at least one):
- Social media URLs (X/Twitter, LinkedIn, GitHub, or website)
- Full name (first and last name)

**Optional but Helpful**:
- Location (city and country)

### How It Works

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write'
  // No input - will attempt to scrape
});

if (result.needsUserInfo) {
  // User information is insufficient
  console.log('Missing:', result.missingUserInfo);
  // ["social_urls", "full_name", "location"]
  
  // Chat graph will request this info from the user
}
```

### Example Flow

```typescript
// First attempt without sufficient info
const result1 = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write'
});

if (result1.needsUserInfo) {
  // Request info from user through chat
  // User provides: "My LinkedIn is linkedin.com/in/john-smith"
  
  // Second attempt with extracted info
  const result2 = await graph.invoke({
    userId: 'user-123',
    operationMode: 'write',
    input: 'LinkedIn: linkedin.com/in/john-smith, Name: John Smith'
  });
  
  // Now profile will be generated successfully
}
```

### Handling in Chat Interface

The chat graph automatically handles this:

1. Detects `needsUserInfo` flag
2. Constructs friendly clarification message
3. Asks user for missing information
4. Extracts info from user's response
5. Retries profile generation with extracted info

See `USER-INFO-DETECTION-FEATURE.md` for detailed documentation.

---

## Performance Tips

1. **Use query mode when possible**: Save 10-15 LLM calls
2. **Provide input when available**: Skip expensive scraping
3. **Batch operations**: Generate multiple profiles in parallel
4. **Don't force update unnecessarily**: Only update when data actually changes
5. **Let the graph detect**: Don't manually check for missing components

---

## Debugging

### Enable Detailed Logging

All nodes log their execution:

```
[Graph:Profile:CheckState] Checking profile state...
[Graph:Profile:RouteCondition] Profile generation needed with input provided
[Graph:Profile:Generate] Starting profile generation...
[Graph:Profile:Generate] ✅ Profile generated successfully
[Graph:Profile:EmbedSave] Starting profile embedding...
[Graph:Profile:EmbedSave] ✅ Profile saved successfully
[Graph:Profile:HyDE] Starting HyDE generation...
[Graph:Profile:HyDE] ✅ HyDE generated successfully
[Graph:Profile:HyDEEmbed] Starting HyDE embedding...
[Graph:Profile:HyDEEmbed] ✅ HyDE saved successfully
```

### Check State Flags

The graph returns detection flags for debugging:

```typescript
const result = await graph.invoke({ ... });

console.log({
  needsProfileGeneration: result.needsProfileGeneration,
  needsProfileEmbedding: result.needsProfileEmbedding,
  needsHydeGeneration: result.needsHydeGeneration,
  needsHydeEmbedding: result.needsHydeEmbedding,
  error: result.error
});
```

### Trace Graph Execution

For detailed tracing, use LangGraph's built-in streaming:

```typescript
const eventStream = graph.streamEvents(
  { userId: 'user-123', operationMode: 'write' },
  { version: 'v2' }
);

for await (const event of eventStream) {
  if (event.event === 'on_chain_start') {
    console.log('Starting node:', event.name);
  }
  if (event.event === 'on_chain_end') {
    console.log('Finished node:', event.name);
  }
}
```

---

## Migration Checklist

If you're updating existing code:

- [ ] Add `operationMode` parameter to all profile graph invocations
- [ ] Use `'query'` for read-only operations
- [ ] Use `'write'` for generation/update operations
- [ ] Update tests to pass `operationMode`
- [ ] Check for error handling (graph now returns errors instead of throwing)
- [ ] Verify hyde regeneration on profile updates is desired behavior

---

## FAQ

**Q: What happens if I don't specify operationMode?**
A: It defaults to `'write'`, which means full conditional generation. This is backward compatible but not optimal for reads.

**Q: Can I skip hyde generation?**
A: Not currently. Hyde is considered essential for profile matching. If you need this, add a flag to the state.

**Q: Why is my query taking 10 seconds?**
A: You're probably using `operationMode: 'write'` instead of `'query'`. Query mode should take ~100ms.

**Q: How do I force regeneration of everything?**
A: Use `operationMode: 'write'` with `forceUpdate: true` and provide new `input`. This will regenerate profile and hyde.

**Q: What if hyde generation fails?**
A: The graph will log the error and continue. The profile will be saved without hyde. You can re-run the graph later to generate hyde.

**Q: Can I generate just the embedding?**
A: Yes, if the profile exists without an embedding, the graph will detect this and only generate the embedding.

---

## Support

For issues or questions:
1. Check the logs for detailed execution trace
2. Verify the `operationMode` is correct for your use case
3. Check the state flags to see what the graph detected
4. Review the PROFILE-GRAPH-FLOW-DIAGRAM.md for visual flow
5. See PROFILE-GRAPH-REFACTOR-SUMMARY.md for detailed design decisions

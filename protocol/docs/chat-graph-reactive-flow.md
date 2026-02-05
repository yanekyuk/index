# Chat Graph: Reactive Flow Architecture

## Flow Diagram

```
                                    ┌────────────────┐
                                    │     START      │
                                    └────────┬───────┘
                                             │
                                             ▼
                                    ┌────────────────┐
                                    │    ROUTER      │
                                    │ (analyze msg)  │
                                    └────────┬───────┘
                                             │
                                             ▼
                              ┌──────────────────────────┐
                              │  CHECK_PREREQUISITES     │
                              │  • Has complete profile? │
                              │  • Has active intents?   │
                              └──────────┬───────────────┘
                                         │
                ┌────────────────────────┼────────────────────────┐
                │                        │                        │
                ▼                        ▼                        ▼
        ┌───────────────┐       ┌───────────────┐      ┌─────────────────┐
        │ PROFILE_WRITE │       │SUGGEST_INTENTS│      │  LOAD_CONTEXT   │
        │  (onboarding) │       │ (no intents)  │      │ (normal flow)   │
        └───────┬───────┘       └───────┬───────┘      └────────┬────────┘
                │                       │                        │
                │                       │                        ▼
                │                       │               ┌─────────────────┐
                │                       │               │ ROUTE_CONDITION │
                │                       │               │  (action type)  │
                │                       │               └────────┬────────┘
                │                       │                        │
                │                       │        ┌───────────────┼───────────────┐
                │                       │        ▼               ▼               ▼
                │                       │   intent_query   intent_write   profile_query
                │                       │   profile_write  opportunity    scrape_web
                │                       │   respond_direct clarify
                │                       │        │               │               │
                │                       │        └───────────────┼───────────────┘
                │                       │                        │
                └───────────────────────┼────────────────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │GENERATE_RESPONSE │
                              └─────────┬────────┘
                                        │
                                        ▼
                                  ┌──────────┐
                                  │   END    │
                                  └──────────┘
```

## Decision Tree

### Prerequisites Check Decision Tree

```
check_prerequisites
│
├─ hasCompleteProfile = false?
│  └─> profile_write (onboarding)
│      Priority: HIGHEST
│      Message: "To create your profile, I need..."
│
├─ hasActiveIntents = false?
│  └─> suggest_intents
│      Priority: HIGH
│      Message: "Based on your profile, here are some intent ideas..."
│
└─ Both prerequisites satisfied?
   └─> load_context (normal flow)
       Priority: NORMAL
       Continue to router decision
```

## State Transitions

### New User Journey

```
1. User sends first message
   ↓
2. Router analyzes (no context needed)
   ↓
3. Check prerequisites
   State: { hasCompleteProfile: false, hasActiveIntents: false }
   ↓
4. Route to profile_write
   ↓
5. Generate response with profile creation instructions
   ↓
6. END
```

### User with Profile, No Intents

```
1. User sends message
   ↓
2. Router analyzes
   ↓
3. Check prerequisites
   State: { hasCompleteProfile: true, hasActiveIntents: false }
   ↓
4. Route to suggest_intents
   ↓
5. Analyze skills/interests from profile
   ↓
6. Generate personalized intent suggestions
   ↓
7. END
```

### Fully Onboarded User

```
1. User sends message
   ↓
2. Router analyzes
   ↓
3. Check prerequisites
   State: { hasCompleteProfile: true, hasActiveIntents: true }
   ↓
4. Load full context (profile + intents)
   ↓
5. Route based on router decision
   ↓
6. Execute action (intent_query, profile_write, etc.)
   ↓
7. Generate response
   ↓
8. END
```

## Node Dependencies

### Context Requirements by Node

| Node | Requires Profile | Requires Intents | Requires Full Context |
|------|-----------------|-----------------|---------------------|
| router | ❌ | ❌ | ❌ |
| check_prerequisites | ⚠️ (checks existence) | ⚠️ (checks existence) | ❌ |
| profile_write | ❌ (creates it) | ❌ | ❌ |
| suggest_intents | ✅ | ❌ | ❌ |
| load_context | ⚠️ (loads it) | ⚠️ (loads it) | N/A |
| intent_query | ✅ | ✅ | ✅ |
| intent_write | ✅ | ❌ | ✅ |
| profile_query | ✅ | ❌ | ✅ |

Legend:
- ✅ Must exist
- ❌ Not required
- ⚠️ Special behavior

## Performance Optimization

### Context Loading Strategy

#### Before (Always Load)
```
Every request:
1. Load profile from DB
2. Load intents from DB
3. Format intents
4. Then analyze message

Cost: 2 DB queries + formatting on EVERY request
```

#### After (Load on Demand)
```
Most requests:
1. Analyze message (fast)
2. Check prerequisites (fast DB check)
3. Route appropriately
4. Load context ONLY if needed

Cost: 
- New users: 1 lightweight check → skip context loading
- Users without intents: 1 lightweight check + 1 profile load
- Normal users: 1 lightweight check + full context load

Savings: ~50% reduction in DB queries for onboarding users
```

## Testing Scenarios

### Test Case 1: New User Onboarding
```typescript
// Input
state = { userId: "new-user-123", messages: [new HumanMessage("Hello")] }

// Expected Flow
router → check_prerequisites → profile_write → generate_response

// Expected State After Prerequisites
{
  hasCompleteProfile: false,
  hasActiveIntents: false,
  prerequisitesChecked: true
}
```

### Test Case 2: User with Profile, No Intents
```typescript
// Input
state = { 
  userId: "user-with-profile", 
  messages: [new HumanMessage("What should I do?")] 
}

// Expected Flow
router → check_prerequisites → suggest_intents → generate_response

// Expected State After Prerequisites
{
  hasCompleteProfile: true,
  hasActiveIntents: false,
  prerequisitesChecked: true,
  userProfile: { ... }
}

// Expected Response Contains
- Personalized intent suggestions based on skills
- Call to action for creating first intent
```

### Test Case 3: Fully Onboarded User
```typescript
// Input
state = { 
  userId: "onboarded-user", 
  messages: [new HumanMessage("Show my intents")] 
}

// Expected Flow
router → check_prerequisites → load_context → intent_query → generate_response

// Expected State After Prerequisites
{
  hasCompleteProfile: true,
  hasActiveIntents: true,
  prerequisitesChecked: true,
  userProfile: { ... }
}

// Expected State After Load Context
{
  activeIntents: "- Goal 1\n- Goal 2\n..."
}
```

## Error Handling

### Prerequisites Check Failures

```typescript
// Database error during check
try {
  const profile = await db.getProfile(userId);
} catch (error) {
  // Graceful degradation
  return {
    hasCompleteProfile: false,
    hasActiveIntents: false,
    prerequisitesChecked: true,
    error: "Failed to check prerequisites"
  };
}
```

### Profile Incomplete Detection

```typescript
// Profile exists but incomplete
const hasCompleteProfile = !!(
  profile && 
  profile.identity?.name &&
  profile.identity.name.trim() !== ''
);

// Future: More rigorous checks
// - Has location?
// - Has at least one social link?
// - Has meaningful bio?
```

## Future Enhancements

### 1. Profile Completeness Scoring
```typescript
interface ProfileCompleteness {
  score: number; // 0-100
  missingFields: string[];
  suggestions: string[];
}

// Use score to determine if profile is "complete enough"
if (profileCompleteness.score < 60) {
  return "profile_write";
}
```

### 2. Progressive Onboarding
```typescript
// Multi-step profile creation
- Step 1: Basic info (name, location)
- Step 2: Social links (X, LinkedIn, GitHub)
- Step 3: Skills and interests
- Step 4: Bio and goals

// Track onboarding progress
state.onboardingStep = 1;
```

### 3. Intent Quality Check
```typescript
// Don't just check if intents exist, check if they're good
const hasQualityIntents = intents.length > 0 && 
  intents.some(i => i.confidence > 0.7 && i.summary);

if (!hasQualityIntents) {
  return "refine_intents";
}
```

### 4. Conditional Context Loading
```typescript
// Load only what's needed for each action
const contextNeeds = {
  intent_query: ['intents'],
  profile_query: ['profile'],
  intent_write: ['profile', 'intents'],
  opportunity_subgraph: ['profile', 'intents', 'network']
};

// Load selectively
await loadPartialContext(userId, contextNeeds[action]);
```

---

**Architecture Version**: 2.0 (Reactive)  
**Last Updated**: January 30, 2026  
**Status**: ✅ Implemented

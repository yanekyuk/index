# Chat Graph Reactive Flow Refactoring

## Summary

Refactored the chat graph from a linear flow to a reactive, prerequisite-driven flow that prioritizes user onboarding and ensures users have the necessary setup before allowing other operations.

## Key Changes

### 1. **Flow Restructuring**

#### Before (Linear):
```
START → load_context → router → [action] → generate_response → END
```

#### After (Reactive):
```
START → router → check_prerequisites → [conditional routing] → generate_response → END
                                      ↓
                    ┌─────────────────┼─────────────────┐
                    ↓                 ↓                 ↓
            profile_write    suggest_intents    load_context → [action]
            (onboarding)      (no intents)      (normal flow)
```

### 2. **New State Fields** (`chat.graph.state.ts`)

Added prerequisite tracking:
- `hasCompleteProfile: boolean` - Tracks if user has name, location, socials
- `hasActiveIntents: boolean` - Tracks if user has any active intents
- `prerequisitesChecked: boolean` - Flag indicating check was performed

### 3. **New Nodes**

#### `check_prerequisites`
- **Purpose**: Gate that checks if user has complete profile and active intents
- **Location**: Right after router, before any actions
- **Checks**:
  - Profile completeness (has name at minimum)
  - Active intents count
- **Routes to**:
  - `profile_write` if profile incomplete
  - `suggest_intents` if profile exists but no intents
  - `load_context` if both prerequisites satisfied

#### `suggest_intents`
- **Purpose**: Help users create their first intents when profile exists but no intents
- **Behavior**: 
  - Analyzes user's skills and interests from profile
  - Generates personalized intent suggestions
  - Asks what they want to accomplish
- **Example Output**:
  ```
  I see you have a profile set up, but you haven't created any intents yet.
  
  Based on your profile, here are some intent ideas:
  - Share your expertise in JavaScript or Python
  - Find projects that use React and Node.js
  - Connect with others interested in AI or blockchain
  
  What would you like to accomplish or find on this platform?
  ```

### 4. **Modified Nodes**

#### `router`
- **Change**: Now runs FIRST, before loading context
- **Why**: Allows message analysis without expensive context loading
- **Works with**: Minimal context (profile may not be loaded yet)

#### `load_context`
- **Change**: Now runs AFTER prerequisites check and only when needed
- **Why**: Avoids expensive DB queries when redirecting to onboarding
- **Loads**: 
  - User profile (if not already loaded)
  - Active intents (formatted)

### 5. **Conditional Routing Logic**

#### Prerequisites Condition
```typescript
prerequisitesCondition(state) {
  if (!state.hasCompleteProfile) return "profile_write";
  if (!state.hasActiveIntents) return "suggest_intents";
  return "load_context";
}
```

**Priority Order**:
1. Profile completion (highest priority)
2. Intent creation (if profile exists)
3. Normal flow (if both exist)

### 6. **Updated Thinking Events**

New node descriptions for streaming:
- `'router'` → "Analyzing your message..."
- `'check_prerequisites'` → "Checking your profile and intent status..."
- `'suggest_intents'` → "Generating intent suggestions based on your profile..."

## Benefits

### 1. **Smarter Onboarding**
- Users are guided to complete profile before using other features
- After profile completion, system prompts for intent creation
- Clear, contextual suggestions based on user's profile

### 2. **Better Context Loading**
- Context only loaded when actually needed
- Avoids expensive DB queries during onboarding
- Router can analyze message without full context

### 3. **Clearer User Journey**
- Profile → Intents → Features (in that order)
- System proactively suggests next steps
- No confusion about "what to do first"

### 4. **Reactive Architecture**
- Graph responds to user state, not just message
- Prerequisites checked before every interaction
- Automatic routing to appropriate onboarding flow

## User Experience Examples

### Example 1: New User (No Profile)
```
User: "Hello"
Flow: router → check_prerequisites → profile_write
Response: "To create your profile, I need to gather accurate information..."
```

### Example 2: User with Profile, No Intents
```
User: "What can I do here?"
Flow: router → check_prerequisites → suggest_intents → generate_response
Response: "I see you have a profile set up, but you haven't created any intents yet. 
Based on your profile, here are some intent ideas: ..."
```

### Example 3: Fully Onboarded User
```
User: "Show me my intents"
Flow: router → check_prerequisites → load_context → intent_query → generate_response
Response: [Shows user's active intents]
```

## Migration Notes

### Backward Compatibility
- All existing routes still work
- Legacy targets (intent_subgraph, profile_subgraph) mapped to new targets
- No breaking changes to external APIs

### Testing Considerations
- Test profile_write flow when profile missing
- Test suggest_intents flow when intents missing
- Test normal flow when both exist
- Test prerequisite check ordering (profile before intents)

## Future Enhancements

Potential additions:
1. **Profile completeness scoring** - Check for location, socials, bio quality
2. **Intent quality check** - Ensure intents are well-formed before suggesting more
3. **Guided onboarding steps** - Multi-step profile creation wizard
4. **Progressive disclosure** - Gradually reveal features as user completes prerequisites

## Files Modified

1. `protocol/src/lib/protocol/graphs/chat/chat.graph.state.ts`
   - Added prerequisite tracking fields

2. `protocol/src/lib/protocol/graphs/chat/chat.graph.ts`
   - Restructured flow to start with router
   - Added check_prerequisites node
   - Added suggest_intents node
   - Modified load_context to run after prerequisites
   - Updated graph assembly with new conditional routing

## Testing

To test the new flow:

```bash
cd protocol

# Test with user who has no profile
# Expected: Redirects to profile_write

# Test with user who has profile but no intents
# Expected: Shows suggest_intents

# Test with fully onboarded user
# Expected: Normal flow through load_context
```

---

**Implementation Date**: January 30, 2026  
**Status**: ✅ Complete

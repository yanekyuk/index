# Index API Quickstart Guide

This guide covers the essential API endpoints to get started with Index: member creation, joining indexes, adding intents, and discovering connections.

## Base URL

All API requests should be made to:
```
https://index.network/api
```

For local development, use the protocol server base URL (e.g. `http://localhost:3001/api` when running `bun run dev` from the `protocol/` directory).

## Authentication

All endpoints require authentication using a session cookie or Bearer token. Include the token in the `Authorization` header:

```bash
Authorization: Bearer <session_token>
```

**Note**: Users are automatically created in the Index system on first authentication. There is no separate "create member" endpoint - authentication creates the user account automatically.

---

## 1. Join Member to Index

There are two ways to add a member to an index:

### Option A: Join a Public Index

Join a public index (where `joinPolicy` is `'anyone'`).

**Endpoint:**
```http
POST /api/indexes/:id/join
```

**Path Parameters:**
- `id` (UUID, required) - The index ID

**Example Request:**
```bash
curl -X POST https://index.network/api/indexes/5a338a89-4fc4-48d7-999e-2069ef9ee267/join \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

**Example Response:**
```json
{
  "message": "Successfully joined index",
  "index": {
    "id": "5a338a89-4fc4-48d7-999e-2069ef9ee267",
    "title": "AI Research Network",
    "prompt": "A network for AI researchers",
    "permissions": {
      "joinPolicy": "anyone"
    }
  },
  "membership": {
    "indexId": "5a338a89-4fc4-48d7-999e-2069ef9ee267",
    "userId": "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4",
    "permissions": ["member"],
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "alreadyMember": false
}
```

**Error Responses:**
- `403` - Index is private (requires invitation)
- `404` - Index not found
- `200` - User is already a member (returns `alreadyMember: true`)

### Option B: Add Member to Index (Admin/Owner Only)

Add a member to an index with specific permissions. Requires admin or owner access.

**Endpoint:**
```http
POST /api/indexes/:id/members
```

**Path Parameters:**
- `id` (UUID, required) - The index ID

**Request Body:**
```json
{
  "userId": "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4",
  "permissions": ["member"]
}
```

**Permissions:**
- `"member"` - Regular member
- `"admin"` - Admin member (can manage members, but not add owners)
- `"owner"` - Owner (full access, can add other owners)

**Example Request:**
```bash
curl -X POST https://index.network/api/indexes/5a338a89-4fc4-48d7-999e-2069ef9ee267/members \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4",
    "permissions": ["member"]
  }'
```

**Example Response:**
```json
{
  "message": "Member added successfully",
  "member": {
    "id": "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4",
    "name": "John Doe",
    "avatar": "https://example.com/avatar.jpg",
    "permissions": ["member"],
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

**Error Responses:**
- `400` - Invalid request, user already a member, or invalid permissions
- `403` - Insufficient permissions (only owners can add owners)
- `404` - Index or user not found

---

## 2. Add Intent for Member

Add an intent to an index. This is a two-step process:

### Step 1: Create an Intent

Create a new intent (user's goal or interest).

**Endpoint:**
```http
POST /api/intents
```

**Request Body:**
```json
{
  "payload": "Looking for ML researchers to collaborate on AI research projects",
  "isIncognito": false,
  "indexIds": ["5a338a89-4fc4-48d7-999e-2069ef9ee267"]
}
```

**Parameters:**
- `payload` (string, required) - The intent description (min 1 character)
- `isIncognito` (boolean, optional) - Whether the intent is private (default: `false`)
- `indexIds` (array of UUIDs, optional) - Index IDs to associate the intent with immediately

**Example Request:**
```bash
curl -X POST https://index.network/api/intents \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payload": "Looking for ML researchers to collaborate on AI research projects",
    "isIncognito": false,
    "indexIds": []
  }'
```

**Example Response:**
```json
{
  "message": "Intent created successfully",
  "intent": {
    "id": "0a31709f-4120-46c5-9a30-aa94891aa378",
    "payload": "Looking for ML researchers to collaborate on AI research projects",
    "userId": "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4",
    "isIncognito": false,
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### Step 2: Add Intent to Index

Add an existing intent to an index. The intent must belong to the authenticated user.

**Endpoint:**
```http
POST /api/indexes/:id/member-intents/:intentId
```

**Path Parameters:**
- `id` (UUID, required) - The index ID
- `intentId` (UUID, required) - The intent ID

**Example Request:**
```bash
curl -X POST https://index.network/api/indexes/5a338a89-4fc4-48d7-999e-2069ef9ee267/member-intents/0a31709f-4120-46c5-9a30-aa94891aa378 \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

**Example Response:**
```json
{
  "message": "Intent added to index successfully"
}
```

**Error Responses:**
- `400` - Intent already in index or validation error
- `403` - User is not a member of the index
- `404` - Index or intent not found, or intent doesn't belong to user

---

## 3. Call Discovery Endpoint

Discover users based on intents, indexes, or other filters. This endpoint finds users whose intents match your criteria.

**Endpoint:**
```http
POST /api/discover/filter
```

**Request Body:**
```json
{
  "intentIds": ["0a31709f-4120-46c5-9a30-aa94891aa378"],
  "indexIds": ["5a338a89-4fc4-48d7-999e-2069ef9ee267"],
  "userIds": ["b8c3e467-4f65-44e9-9ed8-bdf749b46dc4"],
  "sources": [
    {"type": "file", "id": "123e4567-e89b-12d3-a456-426614174000"},
    {"type": "link", "id": "223e4567-e89b-12d3-a456-426614174001"},
    {"type": "integration", "id": "323e4567-e89b-12d3-a456-426614174002"}
  ],
  "excludeDiscovered": true,
  "page": 1,
  "limit": 50
}
```

**Parameters:**
- `intentIds` (array of UUIDs, optional) - Filter by specific intent IDs
- `indexIds` (array of UUIDs, optional) - Filter by intents in specific indexes
- `userIds` (array of UUIDs, optional) - Filter by specific user IDs
- `sources` (array of objects, optional) - Filter by source type and ID
  - `type` - One of: `"file"`, `"link"`, `"integration"`
  - `id` - UUID of the source
- `excludeDiscovered` (boolean, optional) - Exclude users with existing connections (default: `true`)
- `page` (integer, optional) - Page number (default: `1`, min: `1`)
- `limit` (integer, optional) - Results per page (default: `50`, min: `1`, max: `100`)

**Example Request:**
```bash
curl -X POST https://index.network/api/discover/filter \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "intentIds": ["0a31709f-4120-46c5-9a30-aa94891aa378"],
    "indexIds": ["5a338a89-4fc4-48d7-999e-2069ef9ee267"],
    "excludeDiscovered": true,
    "page": 1,
    "limit": 50
  }'
```

**Example Response:**
```json
{
  "results": [
    {
      "userId": "b8c3e467-4f65-44e9-9ed8-bdf749b46dc4",
      "totalStake": "100",
      "reasonings": [
        "These two intents are related because they are identical, both expressing a desire to collaborate with UX designers and researchers to explore the implications of AI-driven user interfaces on user experience design."
      ],
      "stakeAmounts": ["100"],
      "userIntents": ["0a31709f-4120-46c5-9a30-aa94891aa378"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "hasNext": false,
    "hasPrev": false
  },
  "filters": {
    "intentIds": ["0a31709f-4120-46c5-9a30-aa94891aa378"],
    "userIds": null,
    "indexIds": ["5a338a89-4fc4-48d7-999e-2069ef9ee267"],
    "sources": null,
    "excludeDiscovered": true
  }
}
```

**Response Fields:**
- `results` - Array of discovered users with matching intents
  - `userId` - The discovered user's ID
  - `totalStake` - Total match score (higher = better match)
  - `reasonings` - Array of explanations for why the match was made
  - `stakeAmounts` - Array of individual stake amounts per matched intent
  - `userIntents` - Array of intent IDs that matched
- `pagination` - Pagination metadata
- `filters` - Echo of the filters used in the request

**Error Responses:**
- `400` - Invalid request parameters
- `500` - Server error

---

## Complete Example Workflow

Here's a complete example of using all endpoints together:

```bash
# 1. Authenticate (user is automatically created)
# Get session token from your frontend/auth flow

# 2. Join a public index
curl -X POST https://index.network/api/indexes/5a338a89-4fc4-48d7-999e-2069ef9ee267/join \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# 3. Create an intent
INTENT_RESPONSE=$(curl -X POST https://index.network/api/intents \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payload": "Looking for ML researchers to collaborate on AI research projects",
    "isIncognito": false
  }')

INTENT_ID=$(echo $INTENT_RESPONSE | jq -r '.intent.id')

# 4. Add intent to index
curl -X POST https://index.network/api/indexes/5a338a89-4fc4-48d7-999e-2069ef9ee267/member-intents/$INTENT_ID \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# 5. Discover matching users
curl -X POST https://index.network/api/discover/filter \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"intentIds\": [\"$INTENT_ID\"],
    \"indexIds\": [\"5a338a89-4fc4-48d7-999e-2069ef9ee267\"],
    \"excludeDiscovered\": true,
    \"page\": 1,
    \"limit\": 50
  }"
```

---

## Additional Notes

### User Creation
Users are automatically created when they authenticate for the first time. The authentication guard validates the session and ensures the user exists in the DB. No separate user creation endpoint is needed.

### Index Creation
To create a new index:

```http
POST /api/indexes
```

**Request Body:**
```json
{
  "title": "AI Research Network",
  "prompt": "A network for AI researchers",
  "joinPolicy": "anyone"
}
```

**Join Policies:**
- `"anyone"` - Public index, anyone can join
- `"invite_only"` - Private index, requires invitation

### Error Handling
All endpoints return standard HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

Error responses include an `error` field with a descriptive message:
```json
{
  "error": "User not found"
}
```


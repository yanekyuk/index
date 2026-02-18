---
name: Passport Twitter Verification
overview: Integrate Passport's Stamps-based Twitter/X verification into the profile settings page using server-managed Ethereum wallets (invisible to users) and the Passport Embed widget.
todos:
  - id: schema
    content: Add walletAddress, walletPrivateKey, passportVerifications fields to users table + generate migration
    status: pending
  - id: backend-deps
    content: Install viem in protocol
    status: pending
  - id: passport-service
    content: Create passport.service.ts with wallet generation, message signing, stamp verification, and key encryption
    status: pending
  - id: passport-controller
    content: Create passport.controller.ts with /wallet, /sign, /verify endpoints + register in main.ts
    status: pending
  - id: env-vars
    content: Add Passport env vars to .env.example and .env.development
    status: pending
  - id: frontend-deps
    content: Install @human.tech/passport-embed in frontend
    status: pending
  - id: auth-service
    content: Add Passport methods to frontend auth service
    status: pending
  - id: profile-modal
    content: Add Passport Embed widget and verification UI to ProfileSettingsModal
    status: pending
isProject: false
---

# Passport Twitter/X Verification in Profile Settings

## Architecture

Users don't have wallets, so the backend generates and manages an Ethereum keypair per user. The frontend renders Passport's `PassportScoreWidget` using this server-managed address, and delegates message signing to a backend endpoint. After the user verifies their X account through the widget's OAuth flow, the backend confirms the stamp via the Stamps API.

```mermaid
sequenceDiagram
    participant User
    participant Frontend as Frontend (ProfileSettingsModal)
    participant Backend as Protocol Backend
    participant Passport as Passport API

    User->>Frontend: Opens profile settings, clicks "Verify Identity"
    Frontend->>Backend: GET /auth/passport/wallet
    Backend-->>Backend: Generate keypair if none exists (viem)
    Backend-->>Frontend: { address: "0x..." }
    Frontend->>Frontend: Render PassportScoreWidget with address
    Note over Frontend: Widget shows stamps (X, GitHub, etc.)
    User->>Frontend: Clicks "Verify X" in widget
    Frontend->>Frontend: Passport widget triggers Twitter OAuth popup
    User->>Frontend: Authorizes Twitter account
    Frontend->>Backend: POST /auth/passport/sign { message }
    Backend-->>Backend: Sign message with user's stored private key
    Backend-->>Frontend: { signature }
    Frontend->>Frontend: Widget completes stamp verification
    User->>Frontend: Clicks "Done" / verification complete
    Frontend->>Backend: POST /auth/passport/verify
    Backend->>Passport: GET /v2/stamps/{scorerId}/score/{address}
    Passport-->>Backend: { stamps: { "X": { score, expiration } } }
    Backend-->>Backend: Store verified X status on user record
    Backend-->>Frontend: { verified: true, stamps: { x: true } }
    Frontend->>Frontend: Show verified badge next to X field
```



## Changes Required

### 1. Database Schema ([protocol/src/schemas/database.schema.ts](protocol/src/schemas/database.schema.ts))

Add fields to the `users` table:

```typescript
walletAddress: text('wallet_address'),
walletPrivateKey: text('wallet_private_key'), // encrypted
passportVerifications: json('passport_verifications').$type<{
  x?: { verified: boolean; score: string; expiresAt: string };
}>(),
```

Generate a migration with `bun run db:generate` and apply with `bun run db:migrate`.

### 2. Install Backend Dependencies

- `viem` -- for Ethereum wallet generation and message signing (lighter than ethers.js, better TS support, already a transitive dep via Privy)

### 3. Passport Service ([protocol/src/services/passport.service.ts](protocol/src/services/passport.service.ts))

New service following the [service template](protocol/src/services/service-template.md):

- `getOrCreateWallet(userId)` -- generates a keypair via `viem/accounts` (`generatePrivateKey()` + `privateKeyToAccount()`), stores encrypted private key and address on user record, returns address
- `signMessage(userId, message)` -- loads stored private key, signs message using viem's `account.signMessage()`, returns signature
- `verifyStamps(userId)` -- calls Passport Stamps API `GET /v2/stamps/{SCORER_ID}/score/{address}` with the server-side `PASSPORT_STAMPS_API_KEY`, checks for the `X` stamp in the response, updates `passportVerifications` on user record
- Encryption: use a `PASSPORT_WALLET_ENCRYPTION_KEY` env var to encrypt/decrypt private keys at rest (AES-256-GCM via Node crypto)

### 4. Passport Controller ([protocol/src/controllers/passport.controller.ts](protocol/src/controllers/passport.controller.ts))

New controller following the [controller template](protocol/src/controllers/controller.template.md):

- `@Controller('/auth/passport')`
- `GET /wallet` (guarded by `AuthGuard`) -- returns the user's server-managed wallet address (creates one if needed)
- `POST /sign` (guarded by `AuthGuard`) -- accepts `{ message: string }`, returns `{ signature: string }`
- `POST /verify` (guarded by `AuthGuard`) -- calls Stamps API, stores X verification status, returns result

Register controller in [protocol/src/main.ts](protocol/src/main.ts).

### 5. Environment Variables

Add to [protocol/.env.example](protocol/.env.example) and `.env.development`:

```
PASSPORT_EMBED_API_KEY=       # From developer.passport.xyz (for frontend widget)
PASSPORT_STAMPS_API_KEY=      # From developer.passport.xyz (for backend verification)
PASSPORT_SCORER_ID=           # From developer.passport.xyz
PASSPORT_WALLET_ENCRYPTION_KEY=  # 32-byte hex key for encrypting stored wallet keys
```

### 6. Install Frontend Dependency

- `@human.tech/passport-embed` -- Passport Embed React component

### 7. Frontend: Profile Settings Modal ([frontend/src/components/modals/ProfileSettingsModal.tsx](frontend/src/components/modals/ProfileSettingsModal.tsx))

Add a "Verify Identity" section below the existing Socials section:

- Fetch wallet address from `GET /auth/passport/wallet` when user wants to verify
- Render `PassportScoreWidget` with:
  - `apiKey={NEXT_PUBLIC_PASSPORT_EMBED_API_KEY}` (env var)
  - `scorerId={NEXT_PUBLIC_PASSPORT_SCORER_ID}` (env var)
  - `address={walletAddress}` (from backend)
  - `generateSignatureCallback` -- calls `POST /auth/passport/sign` on the backend
  - `theme={LightTheme}` (matches the white modal)
  - `collapseMode="off"` (always expanded in settings context)
- After widget interaction, call `POST /auth/passport/verify` to confirm and store
- Show a verified checkmark badge next to the X (Twitter) input field when `passportVerifications.x.verified` is true

### 8. Frontend: Environment Variables

Add to [frontend/.env.local](frontend/.env.local):

```
NEXT_PUBLIC_PASSPORT_EMBED_API_KEY=   # Embed API key (safe for frontend)
NEXT_PUBLIC_PASSPORT_SCORER_ID=       # Scorer ID
```

### 9. Auth Service Update ([frontend/src/services/auth.ts](frontend/src/services/auth.ts))

Add methods:

- `getPassportWallet()` -- `GET /auth/passport/wallet`
- `signPassportMessage(message)` -- `POST /auth/passport/sign`
- `verifyPassportStamps()` -- `POST /auth/passport/verify`

## Important Notes

- **X Stamp Requirements**: The X stamp requires: Premium/verified account, 100+ followers, 365+ day old account. Not all users will qualify.
- **Passport Access**: You need to register at [developer.passport.xyz](https://developer.passport.xyz) and create two API keys (one for Embed, one for Stamps API) plus a Scorer with a threshold.
- **Private Key Security**: Server-managed private keys should be encrypted at rest. For production, consider using a KMS (AWS KMS, GCP KMS) instead of a local encryption key.
- **Passport Embed is Premium**: Passport Embed is described as a "premium offering" in the docs. Verify access and pricing at the developer portal.


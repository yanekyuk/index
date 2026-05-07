---
title: "Notification Queue"
type: design
tags: [notifications, bullmq, redis, email, telegram, digest]
created: 2026-05-07
updated: 2026-05-07
---

# Notification Queue

The notification queue (`notification-queue`) is a BullMQ queue that delivers opportunity and negotiation notifications to users. It runs in the main protocol server process and handles two job types: `process_opportunity_notification` and `process_negotiation_notification`.

---

## Priority Tiers

Every opportunity notification is enqueued with one of three priority levels:

| Priority | BullMQ priority value | Delivery path |
|----------|-----------------------|---------------|
| `immediate` | 0 (highest) | WebSocket emit via `emitOpportunityNotification` |
| `high` | 5 | Email sent via the email queue |
| `low` | 10 (lowest) | Added to the weekly digest Redis list |

Callers set priority at enqueue time based on their dispatch path (e.g. ambient real-time delivery uses `immediate`, daily digest sweep uses `low`).

---

## Email Delivery (`high` priority)

Before enqueuing an email, the handler:

1. Loads the recipient's profile via `userService.getUserForNewsletter`.
2. Skips delivery if the user has no email address, has not completed onboarding, or has `prefs.connectionUpdates = false`.
3. Sets a Redis deduplication key (`email:opportunity:dedupe:{userId}:{opportunityId}`) with `NX` and a 7-day TTL. If the key already exists the email is silently dropped — one email per opportunity per user per week.
4. Enqueues to the email queue with a stable `jobId` (`opportunity-email-{userId}-{opportunityId}`) so BullMQ also deduplicates on restarts.

---

## Weekly Digest (`low` priority)

Low-priority notifications accumulate in Redis rather than triggering an immediate send:

- **List key**: `digest:opportunities:{userId}` — a Redis list of opportunity IDs for this user's next digest.
- **Dedupe key**: `digest:dedupe:{userId}:{opportunityId}` — set with `NX` before pushing to the list. If set, the opportunity is already queued and the push is skipped.
- **TTL**: Both keys expire after 7 days (`DIGEST_TTL_SEC = 604800`).

A separate worker (the social worker / digest sweep) reads these lists and dispatches the actual digest emails.

---

## Telegram Delivery

Telegram notifications run **after** the priority switch, independently of the tier. This means a single opportunity notification job may trigger both an email (or digest entry) and a Telegram message.

The handler:
1. Loads the user's Telegram preferences via `getTelegramPrefs(recipientId)`.
2. Checks `telegramPrefs.notifications.opportunityAccepted` — if false, skips.
3. Emits via `emitTelegramNotification` with a link button to the opportunity URL.

This independence is intentional: a user can receive an email for high-priority matches while also getting a real-time Telegram ping. The two channels are not mutually exclusive.

---

## Negotiation Notifications

The `process_negotiation_notification` job type is reserved but not yet fully wired. The handler logs receipt and exits. Future work can route negotiation turn alerts to email or push from here.

---

## Job Lifecycle

All jobs share the same retry and retention settings:

| Setting | Value |
|---------|-------|
| Retries | 3 (exponential backoff, 1 s base) |
| Retain on complete | 24 hours |
| Retain on failure | 7 days |

---

## Singleton

The module exports a `notificationQueue` singleton (and a `queueOpportunityNotification` convenience wrapper). Only the protocol server calls `notificationQueue.startWorker()` — CLI scripts and tests add jobs without starting a worker.

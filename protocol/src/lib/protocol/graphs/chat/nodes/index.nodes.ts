import type { LoggerWithSource } from "../../../../log";
import type { ChatGraphCompositeDatabase } from "../../../interfaces/database.interface";
import type { ChatGraphState, SubgraphResults } from "../chat.graph.state";

/**
 * Creates an index query node that fetches index memberships.
 * If user asks about a specific owned index, returns full members + intents.
 * Implements owner-only access controls.
 */
export function createIndexQueryNode(
  database: ChatGraphCompositeDatabase,
  logger: LoggerWithSource
) {
  return async (state: typeof ChatGraphState.State) => {
    logger.info("🚀 Index query: Checking ownership context...");

    try {
      const memberships = await database.getIndexMemberships(state.userId);
      const ownedIndexes = await database.getOwnedIndexes(state.userId);
      const extractedContext = state.routingDecision?.extractedContext?.trim();

      let specificIndexData: {
        index: unknown;
        members?: unknown[];
        intents?: unknown[];
        isOwner?: boolean;
        accessDeniedMessage?: string;
      } | null = null;
      if (extractedContext) {
        const matchedOwned = ownedIndexes.find((idx) =>
          idx.title.toLowerCase().includes(extractedContext.toLowerCase())
        );
        if (matchedOwned) {
          // Programmatic guard: only fetch owner-only data after verifying ownership.
          // (matchedOwned is from getOwnedIndexes, but this ensures we never leak if matching logic changes.)
          const isOwner = await database.isIndexOwner(matchedOwned.id, state.userId);
          if (!isOwner) {
            const membershipMatch = memberships.find((m) =>
              m.indexTitle.toLowerCase().includes(extractedContext.toLowerCase())
            );
            if (membershipMatch) {
              specificIndexData = {
                index: membershipMatch,
                isOwner: false,
                accessDeniedMessage:
                  "You are a member of this index but not an owner. You can only view your own indexed intents. Ask the owner for full access."
              };
            }
          } else {
            try {
              const [members, intents] = await Promise.all([
                database.getIndexMembersForOwner(matchedOwned.id, state.userId),
                database.getIndexIntentsForOwner(matchedOwned.id, state.userId, { limit: 20 })
              ]);
              specificIndexData = {
                index: matchedOwned,
                members,
                intents,
                isOwner: true
              };
              logger.info("✅ Owner access granted for specific index", {
                indexId: matchedOwned.id,
                memberCount: members.length,
                intentCount: intents.length
              });
            } catch (err) {
              logger.warn("Failed to load owner data for index", {
                indexId: matchedOwned.id,
                error: err instanceof Error ? err.message : String(err)
              });
            }
          }
        } else {
          const membershipMatch = memberships.find((m) =>
            m.indexTitle.toLowerCase().includes(extractedContext.toLowerCase())
          );
          if (membershipMatch) {
            specificIndexData = {
              index: membershipMatch,
              isOwner: false,
              accessDeniedMessage:
                "You are a member of this index but not an owner. You can only view your own indexed intents. Ask the owner for full access."
            };
          }
        }
      }

      logger.info("✅ Index query complete", {
        membershipCount: memberships.length,
        ownedCount: ownedIndexes.length,
        hasSpecificQuery: !!specificIndexData
      });

      const subgraphResults: SubgraphResults = {
        index: {
          mode: 'query',
          memberships,
          ownedIndexes,
          specificIndexData: (specificIndexData ?? undefined) as unknown as NonNullable<SubgraphResults['index']>['specificIndexData'] | undefined,
          count: memberships.length
        }
      };

      return { subgraphResults };
    } catch (error) {
      logger.error("Index query failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        subgraphResults: {
          index: {
            mode: 'query',
            memberships: [],
            ownedIndexes: [],
            count: 0,
            error: 'Failed to fetch index information'
          }
        },
        error: "Index query failed"
      };
    }
  };
}

/**
 * Creates an index write node that updates index settings (owner-only).
 * Parses extracted context for index name and changes to apply.
 */
export function createIndexWriteNode(
  database: ChatGraphCompositeDatabase,
  logger: LoggerWithSource
) {
  return async (state: typeof ChatGraphState.State) => {
    logger.info("📝 Index write: Processing owner operation...");

    const extractedContext = state.routingDecision?.extractedContext?.trim();
    if (!extractedContext) {
      return {
        subgraphResults: {
          index: {
            mode: 'write',
            success: false,
            error: 'No index or changes specified. Please specify which index and what to change (e.g. "make my AI Founders index private").'
          }
        } as SubgraphResults,
        error: "Missing context for index update"
      };
    }

    try {
      const ownedIndexes = await database.getOwnedIndexes(state.userId);
      const colonIdx = extractedContext.indexOf(':');
      const indexName = colonIdx >= 0 ? extractedContext.slice(0, colonIdx).trim() : extractedContext.trim();
      const changesStr = colonIdx >= 0 ? extractedContext.slice(colonIdx + 1).trim() : '';

      // Restrict to indexes the user owns; never use indexId from routing/state.
      const matchedIndex = ownedIndexes.find((idx) =>
        idx.title.toLowerCase().includes(indexName.toLowerCase())
      );
      if (!matchedIndex) {
        return {
          subgraphResults: {
            index: {
              mode: 'write',
              success: false,
              error: `Could not find an index you own matching "${indexName}". Your owned indexes: ${ownedIndexes.map((o) => o.title).join(', ') || 'none'}.`
            }
          } as SubgraphResults
        };
      }

      const isOwner = await database.isIndexOwner(matchedIndex.id, state.userId);
      if (!isOwner) {
        return {
          subgraphResults: {
            index: {
              mode: 'write',
              success: false,
              error: 'Access denied. You must be an owner of this index to modify it.'
            }
          } as SubgraphResults
        };
      }

      const changes: { title?: string; prompt?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean; requireApproval?: boolean } = {};
      if (changesStr) {
        const lower = changesStr.toLowerCase();
        if (lower.includes('private') || lower.includes('invite_only')) {
          changes.joinPolicy = 'invite_only';
        } else if (lower.includes('public') || lower.includes('anyone')) {
          changes.joinPolicy = 'anyone';
        }
        if (lower.includes('guest') && lower.includes('vibe')) {
          changes.allowGuestVibeCheck = !lower.includes('disable') && !lower.includes('off');
        }
        if (lower.includes('require') && lower.includes('approval')) {
          changes.requireApproval = !lower.includes('don\'t') && !lower.includes('disable');
        }
      }

      if (Object.keys(changes).length === 0 && !indexName) {
        return {
          subgraphResults: {
            index: {
              mode: 'write',
              success: false,
              error: 'No changes specified. Say what to change (e.g. "make it private", "change title to X").'
            }
          } as SubgraphResults
        };
      }

      const updatedIndex = await database.updateIndexSettings(
        matchedIndex.id,
        state.userId,
        changes
      );

      logger.info("✅ Index updated successfully", {
        indexId: matchedIndex.id,
        changes: Object.keys(changes)
      });

      return {
        subgraphResults: {
          index: {
            mode: 'write',
            success: true,
            updatedIndex,
            changesApplied: Object.keys(changes)
          }
        } as SubgraphResults
      };
    } catch (error) {
      logger.error("Index write failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        subgraphResults: {
          index: {
            mode: 'write',
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update index'
          }
        } as SubgraphResults,
        error: "Index write failed"
      };
    }
  };
}

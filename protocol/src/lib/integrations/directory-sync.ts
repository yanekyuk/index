import { log } from '../log';

const logger = log.lib.from("lib/integrations/directory-sync.ts");
import { getIntegrationById } from './integration-utils';
import { resolveFileUser } from '../user-utils';
import { DirectorySyncConfig, userIntegrations, indexMembers, indexes } from '../../schemas/database.schema';
import db from '../drizzle/drizzle';
import { eq, and } from 'drizzle-orm';
import { addMemberToIndex } from '../index-members';

export interface Source {
  id: string;
  name: string;
  subSources?: Array<{ id: string; name: string }>;
}

export interface Column {
  id: string;
  name: string;
  type?: string;
}

export interface DirectoryRecord {
  [columnName: string]: any;
}

export interface SyncResult {
  success: boolean;
  membersAdded: number;
  membersUpdated: number;
  errors: Array<{ record: any; error: string }>;
  status: 'success' | 'error' | 'partial';
  error?: string;
}

/**
 * Provider-agnostic interface for directory sync
 */
export interface DirectorySyncProvider {
  listSources(integrationId: string): Promise<Source[]>;
  getSourceSchema(integrationId: string, sourceId: string, subSourceId?: string): Promise<Column[]>;
  fetchRecords(integrationId: string, config: DirectorySyncConfig): Promise<DirectoryRecord[]>;
}

/**
 * Main directory sync function - syncs records from a provider to index members
 */
export async function syncDirectoryMembers(
  integrationId: string,
  provider: DirectorySyncProvider
): Promise<SyncResult> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      return {
        success: false,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'error',
        error: 'Integration not found'
      };
    }

    if (!integration.indexId) {
      return {
        success: false,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'error',
        error: 'Directory sync requires an index integration'
      };
    }

    const config = integration.config?.directorySync;
    if (!config || !config.enabled) {
      return {
        success: false,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'error',
        error: 'Directory sync not configured or disabled'
      };
    }

    // Validate email mapping exists
    if (!config.columnMappings.email) {
      return {
        success: false,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'error',
        error: 'Email column mapping is required'
      };
    }

    logger.info('Starting directory sync', {
      integrationId,
      indexId: integration.indexId,
      source: config.source,
      emailColumn: config.columnMappings.email
    });

    // Fetch records from provider
    const records = await provider.fetchRecords(integrationId, config);
    
    if (records.length === 0) {
      logger.info('No records found for directory sync', { integrationId, source: config.source });
      return {
        success: true,
        membersAdded: 0,
        membersUpdated: 0,
        errors: [],
        status: 'success'
      };
    }

    logger.info('Fetched records for directory sync', {
      integrationId,
      recordCount: records.length,
      sampleColumns: records[0] ? Object.keys(records[0]).slice(0, 5) : []
    });

    // Get index prompt for default member prompt
    const indexData = await db.select({ prompt: indexes.prompt })
      .from(indexes)
      .where(eq(indexes.id, integration.indexId))
      .limit(1);

    const indexPrompt = indexData[0]?.prompt || null;


    const addedMembers: string[] = [];
    const updatedMembers: string[] = [];
    const errors: Array<{ record: any; error: string }> = [];
    
    logger.info('Processing records', {
      integrationId,
      totalRecords: records.length
    });
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      try {
        // Extract email (required)
        const emailRaw = record[config.columnMappings.email];
        const email = emailRaw ? String(emailRaw).trim() : '';
        
        if (!email) {
          errors.push({ record, error: 'Missing email' });
          continue;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          errors.push({ record, error: `Invalid email format: ${email}` });
          continue;
        }

        // Extract profile fields
        const name = config.columnMappings.name 
          ? (record[config.columnMappings.name] ? String(record[config.columnMappings.name]).trim() : '') || email.split('@')[0]
          : email.split('@')[0];
        const intro = config.columnMappings.intro 
          ? (record[config.columnMappings.intro] ? String(record[config.columnMappings.intro]).trim() : '') || undefined
          : undefined;
        const location = config.columnMappings.location
          ? (record[config.columnMappings.location] ? String(record[config.columnMappings.location]).trim() : '') || undefined
          : undefined;

        // Prepare socials object
        const socials: any = {};
        if (config.columnMappings.twitter && record[config.columnMappings.twitter]) {
          let twitterValue = String(record[config.columnMappings.twitter]).trim();
          if (twitterValue) {
            // Remove @ symbol if present
            if (twitterValue.startsWith('@')) {
              twitterValue = twitterValue.substring(1);
            }
            socials.x = twitterValue;
          }
        }
        if (config.columnMappings.linkedin && record[config.columnMappings.linkedin]) {
          const linkedinValue = String(record[config.columnMappings.linkedin]).trim();
          if (linkedinValue) {
            socials.linkedin = linkedinValue;
          }
        }
        if (config.columnMappings.github && record[config.columnMappings.github]) {
          const githubValue = String(record[config.columnMappings.github]).trim();
          if (githubValue) {
            socials.github = githubValue;
          }
        }
        if (config.columnMappings.website && record[config.columnMappings.website]) {
          const websiteValue = String(record[config.columnMappings.website]).trim();
          if (websiteValue) {
            socials.websites = [websiteValue];
          }
        }

        // Find or create user
        const user = await resolveFileUser({
          email,
          name: name || email.split('@')[0],
          avatar: undefined,
          intro,
          location,
          socials: Object.keys(socials).length > 0 ? socials : undefined
        });

        if (!user) {
          errors.push({ record, error: 'Failed to create/find user' });
          continue;
        }

        // Collect metadata from unmapped columns (excluding mapped columns)
        const metadata: Record<string, string | string[]> = {};
        const mappedColumns = [
          config.columnMappings.email,
          config.columnMappings.name,
          config.columnMappings.intro,
          config.columnMappings.location,
          config.columnMappings.twitter,
          config.columnMappings.linkedin,
          config.columnMappings.github,
          config.columnMappings.website
        ].filter(Boolean) as string[];
        const excludedColumns = config.excludedColumns || [];

        for (const [key, value] of Object.entries(record)) {
          if (!mappedColumns.includes(key) && !excludedColumns.includes(key) && value != null) {
            const stringValue = String(value).trim();
            if (stringValue) {
              // Check if value contains multiple values (comma-separated)
              if (stringValue.includes(',')) {
                metadata[key] = stringValue.split(',').map(v => v.trim()).filter(v => v);
              } else {
                metadata[key] = stringValue;
              }
            }
          }
        }

        // Log progress periodically (every 100 records)
        if ((i + 1) % 100 === 0 || i === records.length - 1) {
          logger.info('Directory sync progress', {
            integrationId,
            processed: i + 1,
            total: records.length,
            added: addedMembers.length,
            updated: updatedMembers.length,
            errors: errors.length
          });
        }

        // Check if already a member
        const existingMember = await db.select()
          .from(indexMembers)
          .where(and(
            eq(indexMembers.indexId, integration.indexId),
            eq(indexMembers.userId, user.id)
          ))
          .limit(1);

        if (existingMember.length > 0) {
          // Already a member, update metadata
          await db.update(indexMembers)
            .set({
              metadata: Object.keys(metadata).length > 0 ? metadata : null,
              updatedAt: new Date()
            })
            .where(and(
              eq(indexMembers.indexId, integration.indexId),
              eq(indexMembers.userId, user.id)
            ));
          updatedMembers.push(email);
          continue;
        }

        // Add member to index
        const addResult = await addMemberToIndex({
          indexId: integration.indexId,
          userId: user.id,
          role: 'member',
          prompt: indexPrompt,
          autoAssign: true,
          metadata: Object.keys(metadata).length > 0 ? metadata : null
        });

        if (!addResult.success) {
          logger.warn('Failed to add member to index', {
            integrationId,
            indexId: integration.indexId,
            userId: user.id,
            email,
            error: addResult.error
          });
          throw new Error(addResult.error || 'Failed to add member');
        }

        addedMembers.push(email);
      } catch (error) {
        logger.error('Error processing directory sync record', {
          integrationId,
          error: error instanceof Error ? error.message : String(error)
        });
        errors.push({
          record,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Update sync status in integration config
    const status: 'success' | 'error' | 'partial' = errors.length === 0 
      ? 'success' 
      : addedMembers.length === 0 && updatedMembers.length === 0
        ? 'error' 
        : 'partial';

    const updateConfig: DirectorySyncConfig = {
      ...config,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: status,
      lastSyncError: status !== 'success' && errors.length > 0 
        ? `${errors.length} record(s) failed` 
        : undefined,
      memberCount: addedMembers.length
    };

    // Update integration config in database
    await db.update(userIntegrations)
      .set({ 
        config: { directorySync: updateConfig },
        updatedAt: new Date()
      } as any)
      .where(eq(userIntegrations.id, integrationId));

    logger.info('Directory sync completed', {
      integrationId,
      indexId: integration.indexId,
      membersAdded: addedMembers.length,
      membersUpdated: updatedMembers.length,
      errors: errors.length,
      totalRecords: records.length,
      status,
      errorRate: records.length > 0 ? `${((errors.length / records.length) * 100).toFixed(1)}%` : '0%'
    });

    return {
      success: status !== 'error',
      membersAdded: addedMembers.length,
      membersUpdated: updatedMembers.length,
      errors,
      status
    };
  } catch (error) {
    logger.error('Directory sync error', {
      integrationId,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      success: false,
      membersAdded: 0,
      membersUpdated: 0,
      errors: [],
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}


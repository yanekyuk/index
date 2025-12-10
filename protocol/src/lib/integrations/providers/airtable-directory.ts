import { getClient } from '../composio';
import { getIntegrationById } from '../integration-utils';
import { log } from '../../log';
import type { DirectorySyncProvider, Source, Column, DirectoryRecord } from '../directory-sync';
import type { DirectorySyncConfig } from '../../schema';

interface AirtableBase {
  id: string;
  name?: string;
}

interface AirtableTable {
  id: string;
  name?: string;
  fields?: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

interface AirtableApiResponse {
  data?: {
    response_data?: any;
    bases?: AirtableBase[];
    tables?: AirtableTable[];
    records?: Array<{
      id: string;
      fields: Record<string, any>;
    }>;
    offset?: string;
  };
  error?: string;
  successful?: boolean;
}

const RECORD_LIMIT = 100; // Airtable API pagination limit

export const airtableDirectoryProvider: DirectorySyncProvider = {
  async listSources(integrationId: string): Promise<Source[]> {
    try {
      const integration = await getIntegrationById(integrationId);
      if (!integration || !integration.connectedAccountId) {
        throw new Error('Integration not found or not connected');
      }

      const composio = await getClient();
      const bases: AirtableBase[] = [];
      let offset: string | undefined;

      do {
        const basesResp = await composio.tools.execute('AIRTABLE_LIST_BASES', {
          userId: integration.userId,
          connectedAccountId: integration.connectedAccountId,
          arguments: offset ? { offset } : {}
        }) as AirtableApiResponse;

        const responseData = basesResp?.data?.response_data;
        if (responseData?.bases) {
          bases.push(...responseData.bases);
          offset = responseData.offset;
        } else {
          break;
        }
      } while (offset);

      // For each base, fetch tables to include in subSources
      const sources: Source[] = [];
      for (const base of bases) {
        try {
          const schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
            userId: integration.userId,
            connectedAccountId: integration.connectedAccountId,
            arguments: { baseId: base.id }
          }) as AirtableApiResponse;

          const schemaData = schemaResp?.data?.response_data;
          const tables = schemaData?.tables || [];

          sources.push({
            id: base.id,
            name: base.name || base.id,
            subSources: tables.map((table: AirtableTable) => ({
              id: table.id,
              name: table.name || table.id
            }))
          });
        } catch (error) {
          log.warn('Failed to fetch tables for base', {
            baseId: base.id,
            error: error instanceof Error ? error.message : String(error)
          });
          // Still add base without subSources
          sources.push({
            id: base.id,
            name: base.name || base.id
          });
        }
      }

      return sources;
    } catch (error) {
      log.error('Failed to list Airtable bases', {
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  },

  async getSourceSchema(integrationId: string, sourceId: string, subSourceId?: string): Promise<Column[]> {
    try {
      const integration = await getIntegrationById(integrationId);
      if (!integration || !integration.connectedAccountId) {
        throw new Error('Integration not found or not connected');
      }

      if (!subSourceId) {
        throw new Error('Table ID is required for Airtable');
      }

      const composio = await getClient();
      const schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
        userId: integration.userId,
        connectedAccountId: integration.connectedAccountId,
        arguments: { baseId: sourceId }
      }) as AirtableApiResponse;

      const schemaData = schemaResp?.data?.response_data;
      if (!schemaData?.tables) {
        throw new Error('No tables found in base');
      }

      const table = schemaData.tables.find((t: AirtableTable) => t.id === subSourceId);
      if (!table) {
        throw new Error('Table not found');
      }

      const columns: Column[] = (table.fields || []).map((field: { id: string; name: string; type: string }) => ({
        id: field.id,
        name: field.name,
        type: field.type
      }));

      return columns;
    } catch (error) {
      log.error('Failed to get Airtable table schema', {
        integrationId,
        sourceId,
        subSourceId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  },

  async fetchRecords(integrationId: string, config: DirectorySyncConfig): Promise<DirectoryRecord[]> {
    try {
      log.info('Fetching Airtable records', {
        integrationId,
        baseId: config.source.id,
        tableId: config.source.subId
      });

      const integration = await getIntegrationById(integrationId);
      
      if (!integration || !integration.connectedAccountId) {
        log.error('Airtable integration not found or not connected', { integrationId });
        throw new Error('Integration not found or not connected');
      }

      const baseId = config.source.id;
      const tableId = config.source.subId;
      
      if (!tableId) {
        log.error('Airtable table ID missing', { integrationId, baseId });
        throw new Error('Table ID is required for Airtable directory sync');
      }

      const composio = await getClient();
      const allRecords: DirectoryRecord[] = [];
      let recordOffset: string | undefined;
      let pageCount = 0;

      do {
        pageCount++;
        
        const recordsResp = await composio.tools.execute('AIRTABLE_LIST_RECORDS', {
          userId: integration.userId,
          connectedAccountId: integration.connectedAccountId,
          arguments: {
            baseId,
            tableIdOrName: tableId,
            pageSize: RECORD_LIMIT,
            ...(recordOffset && { offset: recordOffset })
          }
        }) as AirtableApiResponse;

        const records = recordsResp?.data?.records || [];
        const offset = recordsResp?.data?.offset;

        if (records.length === 0) {
          break;
        }

        // Convert Airtable records to DirectoryRecord format
        for (const record of records) {
          // Handle different record structures
          if (record.fields) {
            // Standard Airtable format: { id, fields: {...} }
            allRecords.push(record.fields);
          } else if (typeof record === 'object' && !record.id) {
            // Record is already fields object
            allRecords.push(record);
          } else {
            // Unknown structure, add as-is
            allRecords.push(record);
          }
        }

        recordOffset = offset;
      } while (recordOffset);

      log.info('Fetched Airtable records for directory sync', {
        integrationId,
        baseId,
        tableId,
        recordCount: allRecords.length,
        totalPages: pageCount,
        sampleFields: allRecords.length > 0 ? Object.keys(allRecords[0]).slice(0, 5) : []
      });

      return allRecords;
    } catch (error) {
      log.error('Failed to fetch Airtable records', {
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
};


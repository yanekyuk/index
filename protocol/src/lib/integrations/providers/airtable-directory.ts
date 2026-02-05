import { getClient } from '../composio';
import { getIntegrationById } from '../integration-utils';
import { log } from '../../log';

const logger = log.lib.from("lib/integrations/providers/airtable-directory.ts");
import type { DirectorySyncProvider, Source, Column, DirectoryRecord } from '../directory-sync';
import type { DirectorySyncConfig } from '../../../schemas/database.schema';

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
        let basesResp: AirtableApiResponse;
        try {
          basesResp = await composio.tools.execute('AIRTABLE_LIST_BASES', {
            userId: integration.userId,
            connectedAccountId: integration.connectedAccountId,
            arguments: offset ? { offset } : {}
          }) as AirtableApiResponse;
        } catch (error) {
          logger.error('Airtable LIST_BASES API call failed', {
            integrationId,
            userId: integration.userId,
            connectedAccountId: integration.connectedAccountId,
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }

        // Check for API errors
        if (basesResp?.error) {
          logger.error('Airtable LIST_BASES returned error', {
            integrationId,
            error: basesResp.error,
            successful: basesResp.successful
          });
          throw new Error(`Airtable API error: ${basesResp.error}`);
        }

        // Log response structure for debugging
        if (!basesResp?.data) {
          logger.warn('Airtable LIST_BASES response missing data', {
            integrationId,
            hasData: !!basesResp?.data,
            hasError: !!basesResp?.error,
            successful: basesResp?.successful,
            responseKeys: basesResp ? Object.keys(basesResp) : []
          });
        }

        const responseData = basesResp?.data?.response_data;
        if (!responseData) {
          logger.warn('Airtable LIST_BASES response missing response_data', {
            integrationId,
            dataKeys: basesResp?.data ? Object.keys(basesResp.data) : [],
            hasBases: !!basesResp?.data?.bases,
            error: basesResp?.error
          });
          // Try alternative structure: data.bases directly
          if (basesResp?.data?.bases) {
            bases.push(...basesResp.data.bases);
            offset = basesResp.data.offset;
          } else {
            break;
          }
        } else if (responseData?.bases) {
          bases.push(...responseData.bases);
          offset = responseData.offset;
        } else {
          logger.warn('Airtable LIST_BASES response_data missing bases', {
            integrationId,
            responseDataKeys: Object.keys(responseData || {}),
            hasOffset: !!responseData?.offset
          });
          break;
        }
      } while (offset);

      logger.info('Airtable bases fetched', { integrationId, baseCount: bases.length });

      // For each base, fetch tables to include in subSources
      const sources: Source[] = [];
      for (const base of bases) {
        try {
          const schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
            userId: integration.userId,
            connectedAccountId: integration.connectedAccountId,
            arguments: { baseId: base.id }
          }) as AirtableApiResponse;

          // Log response structure for debugging
          if (!schemaResp?.data) {
            logger.warn('Airtable GET_BASE_SCHEMA response missing data', {
              integrationId,
              baseId: base.id,
              hasData: !!schemaResp?.data,
              hasError: !!schemaResp?.error,
              successful: schemaResp?.successful
            });
          }

          const schemaData = schemaResp?.data?.response_data;
          if (!schemaData) {
            logger.warn('Airtable GET_BASE_SCHEMA response missing response_data', {
              integrationId,
              baseId: base.id,
              dataKeys: schemaResp?.data ? Object.keys(schemaResp.data) : [],
              hasTables: !!schemaResp?.data?.tables,
              error: schemaResp?.error
            });
            // Try alternative structure: data.tables directly
            const tables = schemaResp?.data?.tables || [];
            sources.push({
              id: base.id,
              name: base.name || base.id,
              subSources: tables.map((table: AirtableTable) => ({
                id: table.id,
                name: table.name || table.id
              }))
            });
          } else {
            const tables = schemaData?.tables || [];
            logger.info('Fetched tables for base', {
              integrationId,
              baseId: base.id,
              baseName: base.name,
              tableCount: tables.length
            });
            sources.push({
              id: base.id,
              name: base.name || base.id,
              subSources: tables.map((table: AirtableTable) => ({
                id: table.id,
                name: table.name || table.id
              }))
            });
          }
        } catch (error) {
          logger.warn('Failed to fetch tables for base', {
            integrationId,
            baseId: base.id,
            baseName: base.name,
            error: error instanceof Error ? error.message : String(error)
          });
          // Still add base without subSources
          sources.push({
            id: base.id,
            name: base.name || base.id
          });
        }
      }

      logger.info('Airtable sources list complete', {
        integrationId,
        sourceCount: sources.length,
        baseCount: bases.length
      });

      return sources;
    } catch (error) {
      logger.error('Failed to list Airtable bases', {
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
      let schemaResp: AirtableApiResponse;
      try {
        schemaResp = await composio.tools.execute('AIRTABLE_GET_BASE_SCHEMA', {
          userId: integration.userId,
          connectedAccountId: integration.connectedAccountId,
          arguments: { baseId: sourceId }
        }) as AirtableApiResponse;
      } catch (error) {
        logger.error('Airtable GET_BASE_SCHEMA API call failed', {
          integrationId,
          sourceId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      // Check for API errors
      if (schemaResp?.error) {
        logger.error('Airtable GET_BASE_SCHEMA returned error', {
          integrationId,
          sourceId,
          error: schemaResp.error
        });
        throw new Error(`Airtable API error: ${schemaResp.error}`);
      }

      // Try response_data first, then fallback to data.tables directly
      const schemaData = schemaResp?.data?.response_data;
      let tables: AirtableTable[] | undefined;
      
      if (schemaData?.tables) {
        tables = schemaData.tables;
      } else if (schemaResp?.data?.tables) {
        tables = schemaResp.data.tables;
        logger.info('Using alternative response structure for GET_BASE_SCHEMA', {
          integrationId,
          sourceId,
          tableCount: tables.length
        });
      }

      if (!tables || tables.length === 0) {
        logger.error('No tables found in base', {
          integrationId,
          sourceId,
          hasData: !!schemaResp?.data,
          hasResponseData: !!schemaData,
          dataKeys: schemaResp?.data ? Object.keys(schemaResp.data) : []
        });
        throw new Error('No tables found in base');
      }

      const table = tables.find((t: AirtableTable) => t.id === subSourceId);
      if (!table) {
        logger.error('Table not found in base', {
          integrationId,
          sourceId,
          subSourceId,
          availableTableIds: tables.map(t => t.id)
        });
        throw new Error('Table not found');
      }

      const columns: Column[] = (table.fields || []).map((field: { id: string; name: string; type: string }) => ({
        id: field.id,
        name: field.name,
        type: field.type
      }));

      return columns;
    } catch (error) {
      logger.error('Failed to get Airtable table schema', {
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
      logger.info('Fetching Airtable records', {
        integrationId,
        baseId: config.source.id,
        tableId: config.source.subId
      });

      const integration = await getIntegrationById(integrationId);
      
      if (!integration || !integration.connectedAccountId) {
        logger.error('Airtable integration not found or not connected', { integrationId });
        throw new Error('Integration not found or not connected');
      }

      const baseId = config.source.id;
      const tableId = config.source.subId;
      
      if (!tableId) {
        logger.error('Airtable table ID missing', { integrationId, baseId });
        throw new Error('Table ID is required for Airtable directory sync');
      }

      const composio = await getClient();
      const allRecords: DirectoryRecord[] = [];
      let recordOffset: string | undefined;
      let pageCount = 0;

      do {
        pageCount++;
        
        let recordsResp: AirtableApiResponse;
        try {
          recordsResp = await composio.tools.execute('AIRTABLE_LIST_RECORDS', {
            userId: integration.userId,
            connectedAccountId: integration.connectedAccountId,
            arguments: {
              baseId,
              tableIdOrName: tableId,
              pageSize: RECORD_LIMIT,
              ...(recordOffset && { offset: recordOffset })
            }
          }) as AirtableApiResponse;
        } catch (error) {
          logger.error('Airtable LIST_RECORDS API call failed', {
            integrationId,
            baseId,
            tableId,
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }

        // Check for API errors
        if (recordsResp?.error) {
          logger.error('Airtable LIST_RECORDS returned error', {
            integrationId,
            baseId,
            tableId,
            error: recordsResp.error
          });
          throw new Error(`Airtable API error: ${recordsResp.error}`);
        }

        // Try response_data first, then fallback to data.records directly
        const recordsData = recordsResp?.data?.response_data;
        let records: any[] | undefined;
        let offset: string | undefined;

        if (recordsData?.records) {
          records = recordsData.records;
          offset = recordsData.offset;
        } else if (recordsResp?.data?.records) {
          records = recordsResp.data.records;
          offset = recordsResp.data.offset;
          logger.debug('Using alternative response structure for LIST_RECORDS', {
            integrationId,
            baseId,
            tableId,
            recordCount: records.length
          });
        } else {
          records = [];
        }

        if (!records || records.length === 0) {
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

      logger.info('Fetched Airtable records for directory sync', {
        integrationId,
        baseId,
        tableId,
        recordCount: allRecords.length,
        totalPages: pageCount,
        sampleFields: allRecords.length > 0 ? Object.keys(allRecords[0]).slice(0, 5) : []
      });

      return allRecords;
    } catch (error) {
      logger.error('Failed to fetch Airtable records', {
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
};


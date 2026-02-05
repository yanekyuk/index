# Service Implementation Guide

Services are the core business logic layer of the application. They handle data access, complex business rules, and orchestration between different parts of the system (DB, Agents, Queues).

## Location & Naming
- **File**: \`src/services/<domain>.service.ts\` (e.g., \`user.service.ts\`, \`stake.service.ts\`)
- **Class**: PascalCase, ending in \`Service\` (e.g., \`UserService\`)
- **Instance**: camelCase, same name as file (e.g., \`userService\`)

## Standard Template

All services should follow this structure:

\`\`\`typescript
import db from '../lib/drizzle/drizzle';
import { myTable, relatedTable } from '../schemas/database.schema';
import { eq, and, desc } from 'drizzle-orm';
import { log } from '../lib/log';

/**
 * [ServiceName]
 * 
 * [Brief description of what this service does]
 * 
 * RESPONSIBILITIES:
 * - [Responsibility 1]
 * - [Responsibility 2]
 */
export class MyService {
  /**
   * [Method Description]
   * 
   * @param id - [Param description]
   * @returns [Return description]
   */
  async getById(id: string) {
    log.info('[MyService] Getting item', { id });
    
    const result = await db.select()
      .from(myTable)
      .where(eq(myTable.id, id))
      .limit(1);
      
    return result[0] || null;
  }

  /**
   * Standard Create/Update operation
   */
  async createItem(data: { name: string; userId: string }) {
    try {
      log.info('[MyService] Creating item', { userId: data.userId });

      const [newItem] = await db.insert(myTable)
        .values({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();

      return newItem;
    } catch (error) {
      log.error('[MyService] Failed to create item', { error, data });
      throw error; // Or handle gracefully depending on requirement
    }
  }
}

// Export a singleton instance
export const myService = new MyService();
\`\`\`

## Best Practices

### 1. Database Access
- Always import \`db\` from \`../lib/drizzle/drizzle\`.
- Import tables and types from \`../lib/schema\`.
- Use \`drizzle-orm\` operators (\`eq\`, \`and\`, \`or\`, etc.) for queries.
- Prefer `async/await` for all DB operations.

### 2. Logging
- Use standard logger: \`import { log } from '../lib/log';\`.
- Structure logs with the service name prefix: \`[MyService] ...\`.
- Log important state changes and errors.
- Pass metadata objects as the second argument to \`log.info/error\`.

### 3. Dependencies
- Services should be standalone where possible.
- If a service needs another service, import the **class** and instantiate it or use the exported singleton, but be wary of circular dependencies.
- **Circular Dependency Rule**: If Service A needs Service B, and Service B needs Service A, consider refactoring shared logic into a \`lib/\` utility or a third service.
- **Agents**: Import agents directly from \`../agents/...\`.

### 4. Code Style
- **JSDoc**: Every public method must have a JSDoc comment explaining "Why" and "What".
- **Types**: Use inferred types from Drizzle where possible (\`typeof myTable.$inferSelect\`), or explicit interfaces if passing complex DTOs.
- **Return Values**: 
  - For "Get" methods: return \`null\` if not found (don't throw).
  - For "Action" methods: throw detailed errors if the action fails (to catch in the controller/worker).

### 5. Singleton Pattern
- Always export a \`const\` instance at the bottom of the file.
- This ensures a single connection/state across the application.
- Exception: If the service holds user-specific state (rare), export the class only.

## Anti-Patterns (Don't do this)
- ❌ **Direct SQL**: Avoid \`db.execute(sql\`...\`)\` unless absolutely necessary for performance. Use Drizzle's query builder.
- ❌ **Console Logs**: Use \`log.info/error\`, do not use \`console.log\`.
- ❌ **Global State**: Do not store request-specific state in the service class properties (since it's a singleton).
- ❌ **Controller Logic**: Services should not know about \`req\` and \`res\` objects. They should take pure data arguments.

### 6. Queue Usage
- **Pattern**: Offload heavy/async work to queues (e.g., AI generation, notifications).
- **Import**: Import the queue instance from \`../queues/<domain>.queue.ts\`.
- **Usage**:
  \`\`\`typescript
  import { myQueue } from '../queues/my.queue';
  
  // Inside service method
  await myQueue.add('job_name', { userId: '123' }, { priority: 1 });
  \`\`\`
- **Definition**: Queues are defined in \`src/queues/\` using \`QueueFactory.createQueue\`.

### 7. Postgres Searcher Injection
- **Context**: If your service needs to perform vector search on its own entities using `pgvector`.
- **Pattern**: Implement a `searcher` method and inject it into the `IndexEmbedder`.
- **Example**:
  \`\`\`typescript
  import { IndexEmbedder } from '../lib/embedder';
  import { VectorStoreOption, VectorSearchResult } from '../agents/common/types';
  import { sql, isNotNull, desc } from 'drizzle-orm';
  
  export class MyService {
    private embedder: IndexEmbedder;
  
    constructor() {
      // Inject the local search method
      this.embedder = new IndexEmbedder({
        searcher: this.searchMyEntities.bind(this)
      });
    }
  
    /**
     * Implementation of the Searcher interface for 'my_table'
     */
    private async searchMyEntities<T>(vector: number[], collection: string, options?: VectorStoreOption<T>): Promise<VectorSearchResult<T>[]> {
      const limit = options?.limit || 10;
      const vectorString = JSON.stringify(vector);
  
      // Use pgvector operator <=> for cosine distance
      const results = await db.select({
        item: myTable,
        distance: sql<number>\`\${myTable.embedding} <=> \${vectorString}\`
      })
        .from(myTable)
        .where(isNotNull(myTable.embedding))
        .orderBy(sql\`\${myTable.embedding} <=> \${vectorString}\`)
        .limit(limit);
  
      return results.map(r => ({
        item: r.item as unknown as T,
        score: 1 - r.distance // Convert distance to similarity score
      }));
    }
  }
  \`\`\`



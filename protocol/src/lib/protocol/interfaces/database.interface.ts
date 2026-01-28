/**
 * Generic filter options for querying database records.
 * Allows specifying conditions, field selection, and pagination.
 */
export type DatabaseFilterOption<T> = {
  /**
   * Filter conditions - passed directly to the underlying database implementation.
   * Structure depends on the database (e.g., Prisma where clause, MongoDB query, etc.)
   */
  filter?: Record<string, any>;

  /**
   * Fields to select/project in the result.
   * When provided, only these fields will be returned.
   * Keys are field names, values indicate inclusion (true) or exclusion (false).
   */
  select?: Partial<Record<keyof T, boolean>>;

  /** Maximum number of records to return */
  limit?: number;

  /** Number of records to skip (for pagination) */
  offset?: number;
};

/**
 * Options for creating a new record.
 */
export type DatabaseCreateOption<T> = {
  /** The data to insert */
  data: T;
};

/**
 * Options for updating existing records.
 */
export type DatabaseUpdateOption<T> = {
  /** Filter to identify records to update */
  filter: Record<string, any>;

  /** Partial data to update on matching records */
  data: Partial<T>;
};

/**
 * Abstract database interface for performing CRUD operations.
 * This interface allows passing a database instance to functions
 * without coupling them to a specific database implementation.
 *
 * Implementations should adapt this interface to their specific
 * database (e.g., Prisma, MongoDB, DynamoDB, etc.)
 */
export interface Database {
  /**
   * Retrieve a single record from the specified collection/table.
   *
   * @param collection - The name of the collection or table
   * @param options - Filter and projection options
   * @returns The matching record or null if not found
   */
  get<T>(
    collection: string,
    options: DatabaseFilterOption<T>
  ): Promise<T | null>;

  /**
   * Retrieve a single record by its ID.
   * 
   * @param collection - The name of the collection or table
   * @param id - The unique identifier of the record
   * @returns The matching record or null if not found
   */
  getById<T>(
    collection: string,
    id: string
  ): Promise<T | null>;

  /**
   * Retrieve multiple records from the specified collection/table.
   *
   * @param collection - The name of the collection or table
   * @param options - Filter, projection, and pagination options
   * @returns Array of matching records
   */
  getMany<T>(
    collection: string,
    options?: DatabaseFilterOption<T>
  ): Promise<T[]>;

  /**
   * Create a new record in the specified collection/table.
   *
   * @param collection - The name of the collection or table
   * @param options - The data to insert
   * @returns The created record
   */
  create<T>(
    collection: string,
    options: DatabaseCreateOption<T>
  ): Promise<T>;

  /**
   * Update existing records matching the filter criteria.
   *
   * @param collection - The name of the collection or table
   * @param options - Filter and data to update
   * @returns The number of updated records
   */
  update<T>(
    collection: string,
    options: DatabaseUpdateOption<T>
  ): Promise<number>;

  /**
   * Count the number of records matching the filter criteria.
   *
   * @param collection - The name of the collection or table
   * @param options - Filter options (only filter is typically used)
   * @returns The count of matching records
   */
  count<T>(
    collection: string,
    options?: Pick<DatabaseFilterOption<T>, 'filter'>
  ): Promise<number>;

  /**
   * Check if any record exists matching the filter criteria.
   *
   * @param collection - The name of the collection or table
   * @param options - Filter options (only filter is typically used)
   * @returns True if at least one matching record exists
   */
  exists<T>(
    collection: string,
    options: Pick<DatabaseFilterOption<T>, 'filter'>
  ): Promise<boolean>;

  /**
   * Delete records matching the filter criteria.
   *
   * @param collection - The name of the collection or table
   * @param options - Filter options to identify records to delete
   * @returns The number of deleted records
   */
  delete<T>(
    collection: string,
    options: Pick<DatabaseFilterOption<T>, 'filter'>
  ): Promise<number>;
}

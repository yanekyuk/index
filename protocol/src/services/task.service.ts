import { conversationDatabaseAdapter, ConversationDatabaseAdapter } from '../adapters/database.adapter';

/**
 * Manages A2A task lifecycle and artifact creation.
 * @remarks Delegates all persistence to ConversationDatabaseAdapter. Does not call other services.
 */
export class TaskService {
  constructor(private db: ConversationDatabaseAdapter = conversationDatabaseAdapter) {}

  /**
   * Creates a task in the 'submitted' state for a given conversation.
   * @param conversationId - Conversation the task belongs to
   * @param metadata - Optional task metadata
   * @returns The newly created task
   */
  async createTask(conversationId: string, metadata?: Record<string, unknown>) {
    return this.db.createTask(conversationId, metadata);
  }

  /**
   * Transitions a task to a new state.
   * @param taskId - Task ID
   * @param state - New task state
   * @param statusMessage - Optional status message payload
   * @returns The updated task
   * @throws If the task is not found
   */
  async updateState(taskId: string, state: string, statusMessage?: unknown) {
    return this.db.updateTaskState(taskId, state, statusMessage);
  }

  /**
   * Retrieves a task by ID.
   * @param taskId - Task ID
   * @returns The task, or null if not found
   */
  async getTask(taskId: string) {
    return this.db.getTask(taskId);
  }

  /**
   * Lists all tasks for a conversation, ordered by creation time.
   * @param conversationId - Conversation ID
   * @returns Ordered list of tasks
   */
  async getTasksByConversation(conversationId: string) {
    return this.db.getTasksByConversation(conversationId);
  }

  /**
   * Creates an artifact linked to a task.
   * @param taskId - Task ID
   * @param data - Artifact payload (name, description, parts, metadata)
   * @returns The newly created artifact
   */
  async createArtifact(
    taskId: string,
    data: { name?: string; description?: string; parts: unknown[]; metadata?: Record<string, unknown> },
  ) {
    return this.db.createArtifact({ taskId, ...data });
  }

  /**
   * Lists all artifacts for a task, ordered by creation time.
   * @param taskId - Task ID
   * @returns Ordered list of artifacts
   */
  async getArtifacts(taskId: string) {
    return this.db.getArtifacts(taskId);
  }
}

/**
 * Configuration for a table column.
 */
interface TableColumn {
  /** The text to display in the header cell */
  header: string;
  /** The key in the data object to access the value */
  key: string;
  /** Optional width hint (not enforced in basic MD) */
  width?: number;
}

/**
 * Options for creating a markdown table.
 */
interface TableOptions {
  /** Array of column definitions */
  columns: TableColumn[];
}

/**
 * Utility for converting JSON data structures into Markdown format.
 * Supports lists, tables, and recursive object structures.
 */
export const json2md = {
  /**
   * Smartly converts any JSON data to Markdown.
   * Auto-detects arrays of objects to render as tables.
   */
  toMarkdown(data: any): string {
    if (Array.isArray(data)) {
      if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
        // Array of Objects -> Table
        const keys = Array.from(new Set(data.flatMap((item: any) => Object.keys(item))));
        const columns = keys.map(k => ({ header: k, key: k }));
        return this.table(data, { columns });
      } else {
        // Array of Primitives -> List
        return this.list(data.map(String));
      }
    }
    if (typeof data === 'object' && data !== null) {
      return this.fromObject(data);
    }
    return String(data);
  },
  /**
   * Creates a markdown list from an array of strings.
   * 
   * @param items - The array of strings to list.
   * @param ordered - If true, creates a numbered list (1., 2.). Default is false (bullet points).
   * @returns The formatted markdown list string.
   */
  list(items: string[], ordered: boolean = false): string {
    if (!items || items.length === 0) return '';
    return items.map((item, index) => {
      const bullet = ordered ? `${index + 1}.` : '-';
      return `${bullet} ${item}`;
    }).join('\n');
  },

  /**
   * Creates a markdown table from an array of objects.
   * 
   * @param data - The array of objects to display in the table.
   * @param options - Configuration options for the table (columns).
   * @returns The formatted markdown table string.
   */
  table(data: any[], options: TableOptions): string {
    if (!data || data.length === 0) return '';

    const headers = options.columns.map(c => c.header);
    const keys = options.columns.map(c => c.key);

    // Header row
    let markdown = `| ${headers.join(' | ')} |\n`;

    // Separator row
    markdown += `| ${headers.map(() => '---').join(' | ')} |\n`;

    // Data rows
    markdown += data.map(row => {
      const cells = keys.map(key => {
        const val = row[key];
        return val !== undefined && val !== null ? String(val) : '';
      });
      return `| ${cells.join(' | ')} |`;
    }).join('\n');

    return markdown;
  },

  /**
   * Recursively converts an object to markdown.
   * Handles nested objects as headers and arrays as lists.
   * 
   * @param obj - The object to convert.
   * @param headerLevel - The starting header level for nested objects. Default is 2 (starts with ##).
   * @returns The formatted markdown string.
   */
  fromObject(obj: Record<string, any>, headerLevel: number = 2): string {
    if (!obj || typeof obj !== 'object') return '';

    const lines: string[] = [];

    Object.entries(obj).forEach(([key, value]) => {
      // Helper to capitalize key for display
      const label = key.charAt(0).toUpperCase() + key.slice(1);

      if (value === null || value === undefined) {
        return; // Skip empty
      }

      if (Array.isArray(value)) {
        lines.push(`**${key}**:`);
        if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
          // Array of objects -> Table
          const keys = Array.from(new Set(value.flatMap((item: any) => Object.keys(item))));
          const columns = keys.map(k => ({ header: k, key: k }));
          lines.push(this.table(value, { columns }));
        } else {
          // Array of primitives -> List
          lines.push(this.list(value.map(String)));
        }
      } else if (typeof value === 'object') {
        // Handle Nested Object: Header + Recursion
        lines.push(`\n${'#'.repeat(headerLevel)} ${label}`);
        lines.push(this.fromObject(value, headerLevel + 1));
      } else {
        // Handle Primitive: Key-Value
        lines.push(`**${key}**: ${value}`);
      }
    });

    return lines.join('\n\n').trim();
  },

  /**
   * Converts a generic object to a markdown key-value representation.
   * Wrapper around `fromObject`.
   * 
   * @param obj - The object to convert.
   * @returns The formatted markdown string.
   */
  keyValue(obj: Record<string, any>): string {
    return this.fromObject(obj, 2);
  }
};

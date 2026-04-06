/**
 * Contact command handlers for the Index CLI.
 * Implements: list, add, remove, import subcommands.
 */
import type { ApiClient } from "./api.client";
import * as output from "./output";

const CONTACT_HELP = `
Usage:
  index contact list                       List your contacts
  index contact add <email> [--name <n>]   Add a contact by email
  index contact remove <email>             Remove a contact
  index contact import --gmail             Import contacts from Gmail
`;

/**
 * Route a contact subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, add, remove, import).
 * @param positionals - Positional arguments after the subcommand.
 * @param options - Additional options (json, name, gmail).
 */
export async function handleContact(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options: { json?: boolean; name?: string; gmail?: boolean },
): Promise<void> {
  if (!subcommand) {
    if (options.json) {
      console.log(JSON.stringify({ error: "No subcommand provided" }));
    } else {
      console.log(CONTACT_HELP);
    }
    return;
  }

  switch (subcommand) {
    case "list": {
      const result = await client.callTool("list_contacts", {});
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to list contacts", 1); return; }
      const data = result.data as { count: number; contacts: Array<{ userId: string; name: string; email: string; isGhost: boolean }> };
      output.heading("Contacts");
      output.contactTable(data.contacts);
      output.dim(`\n  ${data.count} contact${data.count !== 1 ? "s" : ""}`);
      console.log();
      return;
    }
    case "add": {
      const email = positionals[0];
      if (!email) { output.error("Missing email. Usage: index contact add <email>", 1); return; }
      const result = await client.callTool("add_contact", { email, name: options.name });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to add contact", 1); return; }
      const data = result.data as { message: string };
      output.success(data.message);
      return;
    }
    case "remove": {
      const email = positionals[0];
      if (!email) { output.error("Missing email. Usage: index contact remove <email>", 1); return; }
      // Resolve email -> userId via list_contacts
      const listResult = await client.callTool("list_contacts", {});
      if (!listResult.success) { output.error("Failed to resolve contact", 1); return; }
      const contacts = (listResult.data as { contacts: Array<{ userId: string; email: string }> }).contacts;
      const match = contacts.find((c) => c.email.toLowerCase() === email.toLowerCase());
      if (!match) { output.error(`No contact found with email: ${email}`, 1); return; }
      const result = await client.callTool("remove_contact", { contactUserId: match.userId });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to remove contact", 1); return; }
      output.success(`Removed ${email} from contacts.`);
      return;
    }
    case "import": {
      if (options.gmail) {
        const result = await client.callTool("import_gmail_contacts", {});
        if (options.json) { console.log(JSON.stringify(result)); return; }
        if (!result.success) { output.error(result.error ?? "Failed to import Gmail contacts", 1); return; }
        const data = result.data as { message: string };
        output.success(data.message);
      } else {
        output.error("Specify import source: --gmail", 1);
      }
      return;
    }
    default: {
      if (options.json) {
        console.log(JSON.stringify({ error: `Unknown subcommand: ${subcommand}` }));
      } else {
        output.error(`Unknown subcommand: ${subcommand}`);
        console.log(CONTACT_HELP);
      }
      return;
    }
  }
}

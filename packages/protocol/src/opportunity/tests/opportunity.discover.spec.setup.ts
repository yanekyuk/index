import { config } from "dotenv";

config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY ||= "test-placeholder-key-for-discover-spec";

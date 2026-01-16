import { z } from "zod";

export const ImplicitIntentSchema = z.object({
  payload: z.string().describe("The concise implicit goal statement derived from the opportunity."),
  confidence: z.number().min(0).max(100).describe("Confidence score (0-100) that this is a valid implicit intent.")
});

export type ImplicitIntent = z.infer<typeof ImplicitIntentSchema>;

export const ImplicitInferrerOutputSchema = z.object({
  intent: ImplicitIntentSchema
});

export type ImplicitInferrerOutput = z.infer<typeof ImplicitInferrerOutputSchema>;

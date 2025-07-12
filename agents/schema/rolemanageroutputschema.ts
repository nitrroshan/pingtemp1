import { z } from "zod";
export const roleAgentOutputSchema = z.object({
  content: z.array(
    z.object({
      Role: z.string().describe("Role of the Agent"),
      Description: z.string().describe("Description of the assigned role"),
      Features: z.array(
        z.object({
          Feature: z.string().describe("Feeature required for this role"),
          Description: z
            .string()
            .describe("Description of feature required for this role"),
        })
      ),
      Knowledge: z.string().describe("Knowledge required for this role"),
      Tools: z.string().describe("Expertise of tools required for this role"),
      Tasks: z.array(
        z
          .string()
          .describe("Group the provided tasks that can be done by this role")
      ),
      type: z.enum(["text"]),
    })
  ),
});

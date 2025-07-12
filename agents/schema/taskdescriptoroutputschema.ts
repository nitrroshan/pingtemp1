import { z } from "zod";
export const TasksFormatter = z.object({
  content: z.array(
    z.object({
      Task: z
        .string()
        .describe("Define the Actionable Task that needs to be performed"),
      Tools: z.string().describe("Tools required to do the Task"),
      Knowledge: z.string().describe("Knowledge required to do the task"),
      Sequence: z
        .string()
        .describe(
          "Relative sequence in which tasks needs to be done in relative to each other. Multiple tasks that can be done parallely can have same sequence number."
        ),
      Description: z
        .string()
        .describe(
          "Description of the task to be done and how to do it using the tools if the task type is Action. Description on how decisions and information required if task type is planning."
        ),
      Reason: z.string().describe("Reason for the task to be performed"),
      Kind: z.enum(["Action", "Planning", "Research"]),
      type: z.enum(["text"]),
    })
  ),
});
//Base on the Kind of task, the agent will decide if the task needs more Plannning or Research or can be done directly using the tools.

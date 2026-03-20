import { GoogleGenAI, Content, Part, FunctionDeclaration, Type, Tool } from "@google/genai";
import { Message } from "../types";

const mapMessagesToContent = (messages: Message[]): Content[] => {
  return messages.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.content } as Part],
  }));
};

const addTaskTool: FunctionDeclaration = {
  name: 'addTask',
  description: 'Add a new task to the task list for the current agent.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'The title/description of the task.',
      },
    },
    required: ['title'],
  },
};

const assignTaskTool: FunctionDeclaration = {
  name: 'assignTask',
  description: 'Assign a task to a sub-agent or another specialized agent. Use this to delegate work.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      agentName: {
        type: Type.STRING,
        description: 'The name of the agent to assign the task to (e.g., Code Architect, Copywriter).',
      },
      taskDescription: {
        type: Type.STRING,
        description: 'A concise description of the task being assigned.',
      },
      reasoning: {
        type: Type.STRING,
        description: 'The reasoning for selecting this specific agent.',
      }
    },
    required: ['agentName', 'taskDescription', 'reasoning'],
  },
};

export const streamGeminiResponse = async (
  apiKey: string,
  modelName: string,
  history: Message[],
  newMessage: string,
  systemInstruction: string,
  onChunk: (text: string) => void,
  toolExecutors?: { [name: string]: (args: any) => any }
): Promise<string> => {
  if (!apiKey) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Conditionally add tools based on what executors are provided
  const functionDeclarations: FunctionDeclaration[] = [];
  if (toolExecutors?.addTask) functionDeclarations.push(addTaskTool);
  if (toolExecutors?.assignTask) functionDeclarations.push(assignTaskTool);

  const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

  // Create a chat session
  const chat = ai.chats.create({
    model: modelName,
    config: {
      systemInstruction: systemInstruction,
      tools: tools,
    },
    history: mapMessagesToContent(history),
  });

  let fullText = "";

  // Recursive function to handle the stream and potential function calls loop
  const processStream = async (result: any) => {
    for await (const chunk of result) {
      // Handle Text
      const text = chunk.text;
      if (text) {
        fullText += text;
        onChunk(text);
      }

      // Handle Function Calls
      const functionCalls = chunk.functionCalls;
      if (functionCalls && functionCalls.length > 0 && toolExecutors) {
        const functionResponses = [];
        
        for (const call of functionCalls) {
          if (toolExecutors[call.name]) {
            console.log(`Executing tool: ${call.name}`, call.args);
            try {
              const execResult = await toolExecutors[call.name](call.args);
              functionResponses.push({
                functionResponse: {
                  name: call.name,
                  id: call.id,
                  response: { result: execResult }
                }
              });
            } catch (err: any) {
              console.error(`Error executing tool ${call.name}:`, err);
              functionResponses.push({
                functionResponse: {
                  name: call.name,
                  id: call.id,
                  response: { error: err.message }
                }
              });
            }
          }
        }

        if (functionResponses.length > 0) {
          // Send tool outputs back to the model
          const nextResult = await chat.sendMessageStream({ message: functionResponses });
          await processStream(nextResult);
        }
      }
    }
  };

  const initialResult = await chat.sendMessageStream({ message: newMessage });
  await processStream(initialResult);

  return fullText;
};
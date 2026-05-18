import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { dirname } from "path";

// Tool definitions
const tools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read and return the contents of a file",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: {
            type: "string",
            description: "The path to the file to read",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Write",
      description: "Write content to a file",
      parameters: {
        type: "object",
        required: ["file_path", "content"],
        properties: {
          file_path: {
            type: "string",
            description: "The path of the file to write to",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Bash",
      description: "Execute a shell command",
      parameters: {
        type: "object",
        required: ["command"],
        properties: {
          command: {
            type: "string",
            description: "The command to execute",
          },
        },
      },
    },
  },
];

// Execute a tool call and return the result string
function executeTool(toolCall: OpenAI.ChatCompletionMessageToolCall): string {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments);

  try {
    if (name === "Read") {
      return readFileSync(args.file_path, "utf-8");
    } else if (name === "Write") {
      const dir = dirname(args.file_path);
      if (dir && dir !== ".") {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(args.file_path, args.content, "utf-8");
      return `Successfully wrote to ${args.file_path}`;
    } else if (name === "Bash") {
      try {
        const output = execSync(args.command, {
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return output || "Command executed successfully (no output)";
      } catch (err: any) {
        // Command failed but we still want to return the output
        let result = "";
        if (err.stdout) result += err.stdout;
        if (err.stderr) result += (result ? "\n" : "") + err.stderr;
        return result || `Command failed with exit code ${err.status}`;
      }
    } else {
      return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

async function main() {
  const [, , flag, prompt] = process.argv;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (flag !== "-p" || !prompt) {
    throw new Error("error: -p flag is required");
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });

  // Initialize conversation with user prompt
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "user", content: prompt },
  ];

  // Agent loop
  while (true) {
    const response = await client.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      messages: messages,
      tools: tools,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("no choices in response");
    }

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // Append assistant message to conversation
    messages.push(assistantMessage);

    // Check if the model wants to call tools
    if (
      assistantMessage.tool_calls &&
      assistantMessage.tool_calls.length > 0
    ) {
      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const result = executeTool(toolCall);

        // Append tool result to conversation
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
      // Continue the loop - send results back to LLM
      continue;
    }

    // No tool calls - output the final response and exit
    // You can use print statements as follows for debugging, they'll be visible when running tests.
    console.error("Logs from your program will appear here!");

    console.log(assistantMessage.content);
    break;
  }
}

main();

import type { Message, Provider, Tool, ToolCall } from "./types.ts";

const MAX_ROUNDS = 10; // Prevent infinite loops if the model keeps calling tools.

export async function runAgentLoop(
    provider: Provider,
    tools: Tool[],
    conversation: Message[]
): Promise<Message[]> {
    // Work on a copy so the caller's list is not modified.
    const messages = [...conversation];

    for (let round = 0; round < MAX_ROUNDS; round++) {
        // Send the whole conversation; get back the model's next messages.
        const reply = await provider.generate(messages, tools);
        messages.push(...reply);

        // Run each tool the model asked for and record its result.
        let calledTool = false;
        for (const message of reply){
            if(message.type !== "tool_call") continue;
            calledTool = true;
            messages.push(await runToolCall(message, tools));
        }

        // No tool calls means the model is done; otherwise go around again.
        if(!calledTool) return messages;
    }

    messages.push({
        type: "assistant",
        text:`Stopped after ${MAX_ROUNDS} rounds without finishing.`,
    })
    return messages;
}

// Runs one tool call. Never throws: any failure becomes an error result for the model.
async function runToolCall(call: ToolCall, tools: Tool[]): Promise<Message> {
    const result = { type: "tool_result" as const, callId: call.id, name: call.name };

    const tool = tools.find(t => t.name === call.name);
    if(!tool) {
        return {...result, output: `Tool ${call.name} not found`, isError: true};
    }

    try {
        return {...result, output: await tool.run(call.args), isError: false};
    }catch(e) {
        const output = e instanceof Error ? e.message :String(e);
        return {...result, output, isError: true};
    }
}


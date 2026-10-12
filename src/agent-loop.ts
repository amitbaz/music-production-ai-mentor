import type { Message, Provider, Tool } from "./types.ts";

export async function runAgentLoop(
    provider: Provider,
    tools: Tool[],
    conversation: Message[]
): Promise<Message[]> {
    // Work on a copy so the caller's list is not modified.
    const messages = [...conversation];

    while (true) {
        // Send the whole conversation; get back the model's next messages.
        const reply = await provider.generate(messages, tools);
        messages.push(...reply);

        // Run each tool the model asked for and record its result.
        let calledTool = false;
        for (const message of reply){
            if(message.type !== "tool_call") continue;
            calledTool = true;
            
            const tool = tools.find(t => t.name === message.name);
            const output = await tool?.run(message.args);
            messages.push({
                type: "tool_result",
                callId: message.id,
                name: message.name,
                output: output ?? "",
                isError: false
            })
        }

        // No tool calls means the model is done; otherwise go around again.
        if(!calledTool) return messages;
    }
}
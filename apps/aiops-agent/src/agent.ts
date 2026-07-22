import {
  ConverseCommand,
  type ContentBlock,
  type Message,
  type ToolResultContentBlock
} from "@aws-sdk/client-bedrock-runtime";
import { aiOpsTools } from "./tools";
import { buildInvestigationPrompt, systemPrompt } from "./prompt";
import type { AiOpsConfig, AlarmStateChangeEvent, CommandClient, ToolContext, ToolDependencies } from "./types";

type AgentDependencies = ToolDependencies & {
  bedrock: CommandClient;
  runTool: typeof import("./tools").executeTool;
};

type ToolJson = Extract<ToolResultContentBlock, { json: unknown }>["json"];

function textFromContent(content: ContentBlock[] | undefined) {
  return (content ?? [])
    .flatMap((block) => ("text" in block && block.text ? [block.text] : []))
    .join("\n")
    .trim();
}

export async function investigateAlarm(
  event: AlarmStateChangeEvent,
  config: AiOpsConfig,
  dependencies: AgentDependencies
) {
  const alarmName = event.detail?.alarmName?.trim();
  if (!alarmName) {
    throw new Error("CloudWatch alarm event is missing detail.alarmName");
  }

  const context: ToolContext = {
    alarmName,
    logGroupPrefixes: config.logGroupPrefixes,
    queueUrls: config.queueUrls
  };
  const messages: Message[] = [
    { role: "user", content: [{ text: buildInvestigationPrompt(event) }] }
  ];

  let completedToolRounds = 0;
  while (true) {
    const response = await dependencies.bedrock.send(
      new ConverseCommand({
        modelId: config.modelId,
        system: [{ text: systemPrompt }],
        messages,
        inferenceConfig: { maxTokens: 1_200, temperature: 0.1 },
        toolConfig: { tools: aiOpsTools }
      })
    );
    const assistantMessage = response.output?.message as Message | undefined;
    if (!assistantMessage) {
      throw new Error("Bedrock returned no assistant message");
    }
    messages.push(assistantMessage);

    const toolUses = (assistantMessage.content ?? []).flatMap((block) =>
      "toolUse" in block && block.toolUse ? [block.toolUse] : []
    );
    if (toolUses.length === 0) {
      if (response.stopReason !== "end_turn") {
        throw new Error(`Bedrock stopped with ${response.stopReason ?? "unknown"} before completing the report`);
      }
      const report = textFromContent(assistantMessage.content);
      if (!report) {
        throw new Error(`Bedrock stopped with ${response.stopReason ?? "unknown"} but returned no report`);
      }
      return report;
    }
    if (response.stopReason !== "tool_use") {
      throw new Error(`Bedrock returned tool requests with unexpected stop reason ${response.stopReason ?? "unknown"}`);
    }
    if (completedToolRounds >= config.maxToolRounds) {
      throw new Error(`AIOps agent exceeded ${config.maxToolRounds} tool rounds`);
    }

    const toolResults: ContentBlock[] = await Promise.all(
      toolUses.map(async (toolUse) => {
        try {
          const result = await dependencies.runTool(toolUse.name ?? "", toolUse.input, context, dependencies);
          return {
            toolResult: {
              toolUseId: toolUse.toolUseId ?? "unknown-tool-use",
              status: "success" as const,
              content: [{ json: result as ToolJson }]
            }
          };
        } catch (error) {
          return {
            toolResult: {
              toolUseId: toolUse.toolUseId ?? "unknown-tool-use",
              status: "error" as const,
              content: [{ text: error instanceof Error ? error.message : "Tool execution failed" }]
            }
          };
        }
      })
    );
    messages.push({ role: "user", content: toolResults });
    completedToolRounds += 1;
  }
}

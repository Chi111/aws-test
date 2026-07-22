import { describe, expect, it, vi } from "vitest";
import { investigateAlarm } from "./agent";
import type { AiOpsConfig, AlarmStateChangeEvent } from "./types";

const event: AlarmStateChangeEvent = {
  source: "aws.cloudwatch",
  time: "2026-07-21T12:00:00.000Z",
  detail: {
    alarmName: "demo-api-errors",
    state: { value: "ALARM", reason: "Threshold crossed" }
  }
};

const config: AiOpsConfig = {
  modelId: "test-model",
  reportTopicArn: "arn:aws:sns:us-east-2:123456789012:reports",
  logGroupPrefixes: ["/aws/lambda/demo-"],
  queueUrls: [],
  maxToolRounds: 4
};

describe("AIOps agent", () => {
  it("executes requested tools and returns the final evidence-based report", async () => {
    const bedrockSend = vi
      .fn()
      .mockResolvedValueOnce({
        stopReason: "tool_use",
        output: {
          message: {
            role: "assistant",
            content: [
              {
                toolUse: {
                  toolUseId: "tool-1",
                  name: "get_alarm_details",
                  input: {}
                }
              }
            ]
          }
        }
      })
      .mockResolvedValueOnce({
        stopReason: "end_turn",
        output: {
          message: {
            role: "assistant",
            content: [{ text: "Summary: the API error alarm crossed its threshold." }]
          }
        }
      });
    const runTool = vi.fn(async () => ({ StateValue: "ALARM", Threshold: 1 }));

    const report = await investigateAlarm(event, config, {
      bedrock: { send: bedrockSend },
      cloudWatch: { send: vi.fn() },
      logs: { send: vi.fn() },
      sqs: { send: vi.fn() },
      runTool,
      now: Date.now,
      wait: vi.fn(async () => undefined)
    });

    expect(report).toContain("Summary:");
    expect(runTool).toHaveBeenCalledWith(
      "get_alarm_details",
      {},
      expect.objectContaining({ alarmName: "demo-api-errors" }),
      expect.anything()
    );
    expect(bedrockSend).toHaveBeenCalledTimes(2);
  });

  it("rejects a partial report when Bedrock stops at the token limit", async () => {
    const bedrockSend = vi.fn(async () => ({
      stopReason: "max_tokens",
      output: {
        message: {
          role: "assistant",
          content: [{ text: "Partial and unsafe to publish" }]
        }
      }
    }));

    await expect(
      investigateAlarm(event, config, {
        bedrock: { send: bedrockSend },
        cloudWatch: { send: vi.fn() },
        logs: { send: vi.fn() },
        sqs: { send: vi.fn() },
        runTool: vi.fn(),
        now: Date.now,
        wait: vi.fn(async () => undefined)
      })
    ).rejects.toThrow("max_tokens");
  });
});

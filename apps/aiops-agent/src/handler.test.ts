import { PublishCommand } from "@aws-sdk/client-sns";
import { describe, expect, it, vi } from "vitest";
import { processAlarmEvent } from "./handler";
import type { AiOpsConfig, AlarmStateChangeEvent } from "./types";

const config: AiOpsConfig = {
  modelId: "test-model",
  reportTopicArn: "arn:aws:sns:us-east-2:123456789012:reports",
  logGroupPrefixes: [],
  queueUrls: [],
  maxToolRounds: 4
};

function dependencies() {
  return {
    bedrock: {
      send: vi.fn(async () => ({
        stopReason: "end_turn",
        output: {
          message: {
            role: "assistant",
            content: [{ text: "No errors found. token=secret-value owner=person@example.com" }]
          }
        }
      }))
    },
    cloudWatch: { send: vi.fn() },
    logs: { send: vi.fn() },
    sqs: { send: vi.fn() },
    sns: { send: vi.fn(async (_command: unknown) => ({})) },
    runTool: vi.fn(),
    now: () => Date.parse("2026-07-21T12:01:00.000Z"),
    wait: vi.fn(async () => undefined)
  };
}

describe("AIOps alarm handler", () => {
  it("ignores events that are not ALARM transitions", async () => {
    const deps = dependencies();
    const result = await processAlarmEvent(
      { source: "aws.cloudwatch", detail: { alarmName: "demo", state: { value: "OK" } } },
      config,
      deps
    );
    expect(result).toEqual({ ignored: true });
    expect(deps.bedrock.send).not.toHaveBeenCalled();
    expect(deps.sns.send).not.toHaveBeenCalled();
  });

  it("publishes a generated report to the dedicated SNS topic", async () => {
    const deps = dependencies();
    const event: AlarmStateChangeEvent = {
      source: "aws.cloudwatch",
      "detail-type": "CloudWatch Alarm State Change",
      time: "2026-07-21T12:00:00.000Z",
      detail: { alarmName: "demo-errors", state: { value: "ALARM", reason: "Threshold crossed" } }
    };

    await processAlarmEvent(event, config, deps);

    expect(deps.sns.send).toHaveBeenCalledOnce();
    const command = deps.sns.send.mock.calls[0]?.[0] as PublishCommand;
    expect(command).toBeInstanceOf(PublishCommand);
    expect(command.input.TopicArn).toBe(config.reportTopicArn);
    expect(command.input.Message).toContain("No errors found.");
    expect(command.input.Message).not.toContain("secret-value");
    expect(command.input.Message).not.toContain("person@example.com");
    expect(command.input.Message).toContain('"status": "completed"');
  });

  it("publishes a sanitized failure report before preserving the retry signal", async () => {
    const deps = dependencies();
    deps.bedrock.send.mockRejectedValueOnce(new Error("Bedrock denied token=secret-value"));
    const event: AlarmStateChangeEvent = {
      id: "event-1",
      source: "aws.cloudwatch",
      "detail-type": "CloudWatch Alarm State Change",
      time: "2026-07-21T12:00:00.000Z",
      detail: { alarmName: "demo-errors", state: { value: "ALARM" } }
    };

    await expect(processAlarmEvent(event, config, deps)).rejects.toThrow("Bedrock denied");

    const command = deps.sns.send.mock.calls[0]?.[0] as PublishCommand;
    expect(command.input.Message).toContain('"status": "failed"');
    expect(command.input.Message).toContain('"eventId": "event-1"');
    expect(command.input.Message).not.toContain("secret-value");
  });
});

import {
  DescribeLogGroupsCommand,
  GetQueryResultsCommand,
  StartQueryCommand
} from "@aws-sdk/client-cloudwatch-logs";
import { DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { describe, expect, it, vi } from "vitest";
import { executeTool, redactLogMessage } from "./tools";
import type { ToolDependencies } from "./types";

function dependencies(logsSend: ToolDependencies["logs"]["send"]): ToolDependencies {
  return {
    cloudWatch: { send: vi.fn() },
    logs: { send: logsSend },
    sqs: { send: vi.fn() },
    now: () => Date.parse("2026-07-21T12:00:00.000Z"),
    wait: vi.fn(async () => undefined)
  };
}

describe("AIOps tools", () => {
  it("queries approved log groups and redacts credentials", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof DescribeLogGroupsCommand) {
        return { logGroups: [{ logGroupName: "/aws/lambda/demo-api" }] };
      }
      if (command instanceof StartQueryCommand) {
        expect(command.input.logGroupNames).toEqual(["/aws/lambda/demo-api"]);
        expect(command.input.startTime).toBe(Date.parse("2026-07-21T11:45:00.000Z") / 1_000);
        return { queryId: "query-1" };
      }
      if (command instanceof GetQueryResultsCommand) {
        return {
          status: "Complete",
          results: [
            [
              { field: "@timestamp", value: "2026-07-21T11:59:00.000Z" },
              { field: "@message", value: "request failed token=secret-value" }
            ]
          ]
        };
      }
      throw new Error("Unexpected command");
    });

    const result = await executeTool(
      "query_recent_errors",
      {},
      { alarmName: "demo-alarm", logGroupPrefixes: ["/aws/lambda/demo-"], queueUrls: [] },
      dependencies(send)
    );

    expect(result).toMatchObject({ matched: 1, logGroupNames: ["/aws/lambda/demo-api"] });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).toContain("[REDACTED]");
  });

  it("redacts bearer tokens and common secret fields", () => {
    expect(redactLogMessage("Authorization: Bearer abc123 password=hunter2")).toBe("Authorization: [REDACTED]");
    const structured = redactLogMessage(
      JSON.stringify({
        token: "secret-value",
        nested: { password: "hunter2", email: "person@example.com" },
        databaseUrl: "postgresql://admin:db-password@database.example.com/app"
      })
    );
    expect(structured).not.toContain("secret-value");
    expect(structured).not.toContain("hunter2");
    expect(structured).not.toContain("person@example.com");
    expect(structured).not.toContain("db-password");
    expect(structured).toContain("[REDACTED]");

    const embedded = redactLogMessage(
      '2026-07-22 ERROR payload={"password":"hunter2","aws_secret_access_key":"aws-secret"}'
    );
    expect(embedded).not.toContain("hunter2");
    expect(embedded).not.toContain("aws-secret");

    const escaped = redactLogMessage('payload={\\"github_token\\":\\"github-secret\\"}');
    expect(escaped).not.toContain("github-secret");
  });

  it("polls a running Logs Insights query until it completes", async () => {
    const statuses = ["Scheduled", "Running", "Complete"];
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof DescribeLogGroupsCommand) {
        return { logGroups: [{ logGroupName: "/aws/lambda/demo-api" }] };
      }
      if (command instanceof StartQueryCommand) {
        return { queryId: "query-2" };
      }
      if (command instanceof GetQueryResultsCommand) {
        const status = statuses.shift();
        return { status, results: status === "Complete" ? [] : undefined };
      }
      throw new Error("Unexpected command");
    });
    const deps = dependencies(send);

    await expect(
      executeTool(
        "query_recent_errors",
        {},
        { alarmName: "demo-alarm", logGroupPrefixes: ["/aws/lambda/demo-"], queueUrls: [] },
        deps
      )
    ).resolves.toMatchObject({ matched: 0 });
    expect(deps.wait).toHaveBeenCalledTimes(2);
  });

  it("converts alarm timestamps to Bedrock-compatible JSON values", async () => {
    const deps = dependencies(vi.fn());
    deps.cloudWatch.send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(DescribeAlarmsCommand);
      return {
        MetricAlarms: [
          {
            AlarmName: "demo-alarm",
            StateValue: "ALARM",
            StateUpdatedTimestamp: new Date("2026-07-21T12:00:00.000Z")
          }
        ]
      };
    });

    const result = await executeTool(
      "get_alarm_details",
      {},
      { alarmName: "demo-alarm", logGroupPrefixes: [], queueUrls: [] },
      deps
    );

    expect(result).toMatchObject({ StateUpdatedTimestamp: "2026-07-21T12:00:00.000Z" });
  });
});

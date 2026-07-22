import { DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import {
  DescribeLogGroupsCommand,
  GetQueryResultsCommand,
  StartQueryCommand,
  StopQueryCommand
} from "@aws-sdk/client-cloudwatch-logs";
import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import type { ToolContext, ToolDependencies } from "./types";

const terminalQueryStatuses = new Set(["Cancelled", "Failed", "Timeout", "Unknown"]);
const sensitiveKey = /^(?:authorization|cookie|set-cookie|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|session|jwt|credential|private[_-]?key|database[_-]?url|connection[_-]?string|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token)|github[_-]?token)$/i;

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback;
}

function redactStructured(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactStructured);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : redactStructured(nested)])
    );
  }
  return typeof value === "string" ? redactPlainText(value) : value;
}

function redactPlainText(value: string) {
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED_PEM]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]")
    .replace(/\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
    .replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(
      /((?:\\?["'])?(?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|session|jwt|credential|private[_-]?key|database[_-]?url|connection[_-]?string|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token)|github[_-]?token)(?:\\?["'])?\s*[:=]\s*)(?:\\?["'][^"'\\]*(?:\\?["'])|[^\s,;}\]]+)/gi,
      "$1[REDACTED]"
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

export function redactSensitiveText(value: string, maximumLength = 2_000) {
  let sanitized = value;
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      sanitized = JSON.stringify(redactStructured(JSON.parse(trimmed)));
    } catch {
      sanitized = value;
    }
  }
  return redactPlainText(sanitized).slice(0, maximumLength);
}

export function redactLogMessage(value: string) {
  return redactSensitiveText(value, 2_000);
}

function rowsFromQuery(results: Array<Array<{ field?: string; value?: string }>> | undefined) {
  return (results ?? []).map((row) =>
    Object.fromEntries(
      row
        .filter((cell): cell is { field: string; value?: string } => Boolean(cell.field))
        .map((cell) => [cell.field, cell.field === "@message" ? redactLogMessage(cell.value ?? "") : cell.value ?? ""])
    )
  );
}

function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

async function discoverLogGroups(prefixes: string[], dependencies: ToolDependencies) {
  const names = new Set<string>();
  for (const prefix of prefixes) {
    let nextToken: string | undefined;
    do {
      const response = await dependencies.logs.send(
        new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, limit: 50, nextToken })
      );
      for (const group of response.logGroups ?? []) {
        if (group.logGroupName) {
          names.add(group.logGroupName);
        }
        if (names.size >= 50) {
          return [...names];
        }
      }
      nextToken = response.nextToken;
    } while (nextToken);
  }
  return [...names];
}

async function queryRecentErrors(input: Record<string, unknown>, context: ToolContext, dependencies: ToolDependencies) {
  const minutes = boundedInteger(input.minutes, 15, 1, 60);
  const limit = boundedInteger(input.limit, 20, 1, 50);
  const logGroupNames = await discoverLogGroups(context.logGroupPrefixes, dependencies);
  if (logGroupNames.length === 0) {
    return { message: "No matching CloudWatch log groups were found", logGroupPrefixes: context.logGroupPrefixes };
  }

  const endTime = Math.floor(dependencies.now() / 1_000);
  const started = await dependencies.logs.send(
    new StartQueryCommand({
      logGroupNames,
      startTime: endTime - minutes * 60,
      endTime,
      limit,
      queryString:
        "fields @timestamp, @logStream, @message | filter @message like /(?i)(error|exception|timeout|failed)/ | sort @timestamp desc"
    })
  );
  if (!started.queryId) {
    throw new Error("CloudWatch Logs did not return a query id");
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await dependencies.logs.send(new GetQueryResultsCommand({ queryId: started.queryId }));
    if (response.status === "Complete") {
      return {
        queryId: started.queryId,
        minutes,
        logGroupNames,
        matched: response.results?.length ?? 0,
        results: rowsFromQuery(response.results)
      };
    }
    if (terminalQueryStatuses.has(response.status ?? "Unknown")) {
      throw new Error(`CloudWatch Logs query ended with status ${response.status ?? "Unknown"}`);
    }
    if (attempt < 11) {
      await dependencies.wait(1_000);
    }
  }
  await dependencies.logs.send(new StopQueryCommand({ queryId: started.queryId })).catch(() => undefined);
  throw new Error("CloudWatch Logs query did not finish before the polling deadline");
}

async function getAlarmDetails(context: ToolContext, dependencies: ToolDependencies) {
  const response = await dependencies.cloudWatch.send(
    new DescribeAlarmsCommand({ AlarmNames: [context.alarmName], MaxRecords: 1 })
  );
  const alarm = response.MetricAlarms?.[0] ?? response.CompositeAlarms?.[0];
  if (!alarm) {
    return { message: "Alarm was not found", alarmName: context.alarmName };
  }
  const safeAlarm = {
    AlarmName: alarm.AlarmName,
    AlarmArn: alarm.AlarmArn,
    AlarmDescription: alarm.AlarmDescription ? redactSensitiveText(alarm.AlarmDescription) : undefined,
    StateValue: alarm.StateValue,
    StateReason: alarm.StateReason ? redactSensitiveText(alarm.StateReason) : undefined,
    StateUpdatedTimestamp: alarm.StateUpdatedTimestamp,
    ActionsEnabled: alarm.ActionsEnabled,
    Namespace: "Namespace" in alarm ? alarm.Namespace : undefined,
    MetricName: "MetricName" in alarm ? alarm.MetricName : undefined,
    Dimensions: "Dimensions" in alarm ? alarm.Dimensions : undefined,
    Statistic: "Statistic" in alarm ? alarm.Statistic : undefined,
    ExtendedStatistic: "ExtendedStatistic" in alarm ? alarm.ExtendedStatistic : undefined,
    Period: "Period" in alarm ? alarm.Period : undefined,
    EvaluationPeriods: "EvaluationPeriods" in alarm ? alarm.EvaluationPeriods : undefined,
    DatapointsToAlarm: "DatapointsToAlarm" in alarm ? alarm.DatapointsToAlarm : undefined,
    Threshold: "Threshold" in alarm ? alarm.Threshold : undefined,
    ComparisonOperator: "ComparisonOperator" in alarm ? alarm.ComparisonOperator : undefined,
    TreatMissingData: "TreatMissingData" in alarm ? alarm.TreatMissingData : undefined,
    AlarmRule: "AlarmRule" in alarm ? alarm.AlarmRule : undefined
  };
  return jsonSafe(safeAlarm);
}

async function getQueueStatus(context: ToolContext, dependencies: ToolDependencies) {
  if (context.queueUrls.length === 0) {
    return { message: "No SQS queue URLs are configured for this agent" };
  }
  const queues = await Promise.all(
    context.queueUrls.map(async (queueUrl) => {
      const response = await dependencies.sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: [
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
            "ApproximateNumberOfMessagesDelayed",
            "RedrivePolicy"
          ]
        })
      );
      return { queueUrl, attributes: response.Attributes ?? {} };
    })
  );
  return { queues };
}

export const aiOpsTools: Tool[] = [
  {
    toolSpec: {
      name: "get_alarm_details",
      description: "Read the current CloudWatch alarm configuration, state, threshold, dimensions, and state reason.",
      inputSchema: { json: { type: "object", properties: {}, additionalProperties: false } }
    }
  },
  {
    toolSpec: {
      name: "query_recent_errors",
      description: "Query recent error, exception, timeout, and failure messages from approved CloudWatch log groups.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            minutes: { type: "number", minimum: 1, maximum: 60 },
            limit: { type: "number", minimum: 1, maximum: 50 }
          },
          additionalProperties: false
        }
      }
    }
  },
  {
    toolSpec: {
      name: "get_sqs_queue_status",
      description: "Read approximate visible, in-flight, delayed, and dead-letter configuration for approved SQS queues.",
      inputSchema: { json: { type: "object", properties: {}, additionalProperties: false } }
    }
  }
];

export async function executeTool(
  name: string,
  input: unknown,
  context: ToolContext,
  dependencies: ToolDependencies
) {
  const objectInput = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  switch (name) {
    case "get_alarm_details":
      return getAlarmDetails(context, dependencies);
    case "query_recent_errors":
      return queryRecentErrors(objectInput, context, dependencies);
    case "get_sqs_queue_status":
      return getQueueStatus(context, dependencies);
    default:
      throw new Error(`Unknown AIOps tool: ${name}`);
  }
}

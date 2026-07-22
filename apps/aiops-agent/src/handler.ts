import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { investigateAlarm } from "./agent";
import { loadConfig } from "./config";
import { executeTool, redactSensitiveText } from "./tools";
import type { AiOpsConfig, AlarmStateChangeEvent, CommandClient, ToolDependencies } from "./types";

type HandlerDependencies = ToolDependencies & {
  bedrock: CommandClient;
  sns: CommandClient;
  runTool: typeof executeTool;
};

function defaultDependencies(): HandlerDependencies {
  return {
    bedrock: new BedrockRuntimeClient({}),
    cloudWatch: new CloudWatchClient({}),
    logs: new CloudWatchLogsClient({}),
    sqs: new SQSClient({}),
    sns: new SNSClient({}),
    runTool: executeTool,
    now: Date.now,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  };
}

function reportSubject(alarmName: string) {
  return `[AIOps] ${redactSensitiveText(alarmName.replace(/[\r\n]/g, " "), 80)}`.slice(0, 100);
}

export async function processAlarmEvent(
  event: AlarmStateChangeEvent,
  config: AiOpsConfig,
  dependencies: HandlerDependencies
) {
  if (
    event.source !== "aws.cloudwatch" ||
    event["detail-type"] !== "CloudWatch Alarm State Change" ||
    event.detail?.state?.value !== "ALARM" ||
    (config.expectedAccountId && event.account !== config.expectedAccountId) ||
    (config.expectedRegion && event.region !== config.expectedRegion)
  ) {
    return { ignored: true };
  }
  const alarmName = event.detail.alarmName?.trim();
  if (!alarmName) {
    throw new Error("CloudWatch alarm event is missing detail.alarmName");
  }

  let investigationError: Error | undefined;
  let analysis: string;
  try {
    analysis = redactSensitiveText(await investigateAlarm(event, config, dependencies), 12_000);
  } catch (error) {
    investigationError = error instanceof Error ? error : new Error("Unknown AIOps investigation failure");
    analysis = redactSensitiveText(
      `Automated Bedrock investigation failed: ${investigationError.message}. Manually inspect the alarm, recent CloudWatch logs, and queue state.`,
      12_000
    );
  }
  const report = {
    schemaVersion: "1.0",
    status: investigationError ? "failed" : "completed",
    eventId: event.id,
    alarmName,
    alarmArn: event.detail.alarmArn,
    eventTime: event.time,
    generatedAt: new Date(dependencies.now()).toISOString(),
    analysis
  };
  await dependencies.sns.send(
    new PublishCommand({
      TopicArn: config.reportTopicArn,
      Subject: reportSubject(alarmName),
      Message: JSON.stringify(report, null, 2)
    })
  );
  console.info(
    JSON.stringify({
      message: "AIOps investigation report published",
      alarmName,
      status: report.status
    })
  );
  if (investigationError) {
    throw investigationError;
  }
  return { ignored: false, alarmName, reportTopicArn: config.reportTopicArn };
}

export async function handler(event: AlarmStateChangeEvent) {
  return processAlarmEvent(event, loadConfig(), defaultDependencies());
}

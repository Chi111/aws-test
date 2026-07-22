import type { AiOpsConfig } from "./types";

function commaSeparated(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function required(value: string | undefined, name: string) {
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AiOpsConfig {
  return {
    modelId: required(environment.BEDROCK_MODEL_ID, "BEDROCK_MODEL_ID"),
    reportTopicArn: required(environment.AIOPS_REPORT_TOPIC_ARN, "AIOPS_REPORT_TOPIC_ARN"),
    logGroupPrefixes: commaSeparated(environment.AIOPS_LOG_GROUP_PREFIXES),
    queueUrls: commaSeparated(environment.AIOPS_QUEUE_URLS),
    maxToolRounds: 4,
    expectedAccountId: environment.AIOPS_EXPECTED_ACCOUNT_ID?.trim() || undefined,
    expectedRegion: environment.AIOPS_EXPECTED_REGION?.trim() || undefined
  };
}

export type AlarmStateChangeEvent = {
  id?: string;
  account?: string;
  region?: string;
  time?: string;
  source?: string;
  "detail-type"?: string;
  detail?: {
    alarmName?: string;
    alarmArn?: string;
    configuration?: unknown;
    state?: {
      value?: string;
      reason?: string;
      timestamp?: string;
    };
    previousState?: {
      value?: string;
      reason?: string;
      timestamp?: string;
    };
  };
};

export type AiOpsConfig = {
  modelId: string;
  reportTopicArn: string;
  logGroupPrefixes: string[];
  queueUrls: string[];
  maxToolRounds: number;
  expectedAccountId?: string;
  expectedRegion?: string;
};

export type CommandClient = {
  send(command: any): Promise<any>;
};

export type ToolContext = {
  alarmName: string;
  logGroupPrefixes: string[];
  queueUrls: string[];
};

export type ToolDependencies = {
  cloudWatch: CommandClient;
  logs: CommandClient;
  sqs: CommandClient;
  now: () => number;
  wait: (milliseconds: number) => Promise<void>;
};

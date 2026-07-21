import { profileUpdatedEventSchema, type ProfileUpdatedEvent } from "./profile-events";

type SqsRecord = {
  messageId: string;
  body: string;
};

type SqsEvent = {
  Records: SqsRecord[];
};

type SqsBatchResponse = {
  batchItemFailures: Array<{ itemIdentifier: string }>;
};

export async function processProfileEvent(event: ProfileUpdatedEvent) {
  // This worker is deliberately side-effect-light for the assignment. Replace
  // this structured audit log with email, analytics, or persistence as needed.
  console.info(
    JSON.stringify({
      message: "Processed profile event",
      eventId: event.eventId,
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
      githubId: event.profile.githubId,
      login: event.profile.login
    })
  );
}

export async function processProfileEventRecord(record: SqsRecord) {
  let payload: unknown;
  try {
    payload = JSON.parse(record.body);
  } catch {
    throw new Error("Profile event body must be valid JSON");
  }

  const parsed = profileUpdatedEventSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Profile event schema validation failed: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  }

  await processProfileEvent(parsed.data);
}

export async function handler(event: SqsEvent): Promise<SqsBatchResponse> {
  const results = await Promise.all(
    event.Records.map(async (record) => {
      try {
        await processProfileEventRecord(record);
        return null;
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "Profile event processing failed",
            messageId: record.messageId,
            error: error instanceof Error ? error.message : "Unknown profile event error"
          })
        );
        return { itemIdentifier: record.messageId };
      }
    })
  );

  return {
    batchItemFailures: results.filter(
      (failure): failure is { itemIdentifier: string } => failure !== null
    )
  };
}

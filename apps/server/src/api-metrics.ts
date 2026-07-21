export function logApiServerErrorMetric(statusCode: number, service: string) {
  if (statusCode < 500) {
    return;
  }

  console.info(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "GitHubProfileSam",
            Dimensions: [["Service"]],
            Metrics: [{ Name: "Api5xxCount", Unit: "Count" }]
          }
        ]
      },
      Service: service,
      Api5xxCount: 1,
      StatusCode: statusCode
    })
  );
}

package main

import (
	"strings"
	"testing"
)

func TestLoadBaseEnvironment(t *testing.T) {
	config, err := loadEnvironment(environment(map[string]string{
		"DEPLOY_MODE":       "base",
		"AWS_ACCOUNT_ID":    "123456789012",
		"AWS_REGION":        "us-east-2",
		"VPC_ID":            "vpc-123",
		"PUBLIC_SUBNET_IDS": "subnet-a, subnet-b",
	}))
	if err != nil {
		t.Fatalf("loadEnvironment returned an error: %v", err)
	}
	if len(config.PublicSubnetIDs) != 2 || config.PublicSubnetIDs[1] != "subnet-b" {
		t.Fatalf("unexpected subnet list: %#v", config.PublicSubnetIDs)
	}
}

func TestLoadPREnvironment(t *testing.T) {
	config, err := loadEnvironment(environment(map[string]string{
		"DEPLOY_MODE":                 "pr",
		"AWS_ACCOUNT_ID":              "123456789012",
		"AWS_REGION":                  "us-east-2",
		"VPC_ID":                      "vpc-123",
		"PUBLIC_SUBNET_IDS":           "subnet-a,subnet-b",
		"PR_NUMBER":                   "42",
		"IMAGE_URI":                   "example.invalid/repository:pr-42-deadbeef",
		"ECS_TASK_EXECUTION_ROLE_ARN": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
		"DATABASE_SECRET_ARN":         "arn:aws:secretsmanager:us-east-2:123456789012:secret:github-profile/database-url",
		"AURORA_SECURITY_GROUP_ID":    "sg-database",
	}))
	if err != nil {
		t.Fatalf("loadEnvironment returned an error: %v", err)
	}
	if config.PRNumber != 42 {
		t.Fatalf("unexpected PR configuration: %#v", config)
	}
}

func TestLoadEnvironmentRejectsUnsafeInputs(t *testing.T) {
	tests := []struct {
		name   string
		values map[string]string
		want   string
	}{
		{
			name: "too few subnets",
			values: map[string]string{
				"DEPLOY_MODE": "base", "AWS_ACCOUNT_ID": "123456789012", "AWS_REGION": "us-east-2",
				"VPC_ID": "vpc-123", "PUBLIC_SUBNET_IDS": "subnet-a",
			},
			want: "at least two",
		},
		{
			name: "listener priority outside ALB range",
			values: prEnvironment(map[string]string{
				"PR_NUMBER": "50001",
			}),
			want: "between 1 and 50000",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := loadEnvironment(environment(test.values))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected error containing %q, got %v", test.want, err)
			}
		})
	}
}

func prEnvironment(overrides map[string]string) map[string]string {
	values := map[string]string{
		"DEPLOY_MODE":                 "pr",
		"AWS_ACCOUNT_ID":              "123456789012",
		"AWS_REGION":                  "us-east-2",
		"VPC_ID":                      "vpc-123",
		"PUBLIC_SUBNET_IDS":           "subnet-a,subnet-b",
		"PR_NUMBER":                   "42",
		"IMAGE_URI":                   "example.invalid/repository:pr-42-deadbeef",
		"ECS_TASK_EXECUTION_ROLE_ARN": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
		"DATABASE_SECRET_ARN":         "arn:aws:secretsmanager:us-east-2:123456789012:secret:github-profile/database-url",
		"AURORA_SECURITY_GROUP_ID":    "sg-database",
	}
	for key, value := range overrides {
		values[key] = value
	}
	return values
}

func environment(values map[string]string) func(string) (string, bool) {
	return func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}
}

package main

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

const (
	baseStackName             = "github-profile-preview-base"
	exportClusterName         = "github-profile-preview-cluster-name"
	exportHTTPListenerARN     = "github-profile-preview-http-listener-arn"
	exportLoadBalancerSGID    = "github-profile-preview-alb-security-group-id"
	exportLoadBalancerDNSName = "github-profile-preview-alb-dns-name"
	exportVPCID               = "github-profile-preview-vpc-id"
	exportPublicSubnetIDs     = "github-profile-preview-public-subnet-ids"
	applicationContainerName  = "api"
	applicationContainerPort  = 8080
)

type environmentConfig struct {
	DeployMode            string
	AccountID             string
	Region                string
	VPCID                 string
	PublicSubnetIDs       []string
	PRNumber              int
	ImageURI              string
	TaskExecutionRoleARN  string
	DatabaseSecretARN     string
	AuroraSecurityGroupID string
}

func main() {
	config, err := loadEnvironment(os.LookupEnv)
	if err != nil {
		panic(err)
	}

	app := awscdk.NewApp(nil)
	stackProps := &awscdk.StackProps{Env: &awscdk.Environment{
		Account: jsii.String(config.AccountID),
		Region:  jsii.String(config.Region),
	}, Synthesizer: awscdk.NewBootstraplessSynthesizer(nil)}

	switch config.DeployMode {
	case "base":
		newBaseStack(app, baseStackName, stackProps, config)
	case "pr":
		newPRStack(app, fmt.Sprintf("github-profile-pr-%d", config.PRNumber), stackProps, config)
	default:
		panic(fmt.Sprintf("unsupported DEPLOY_MODE %q", config.DeployMode))
	}

	app.Synth(nil)
}

func loadEnvironment(lookup func(string) (string, bool)) (environmentConfig, error) {
	required := func(name string) (string, error) {
		value, ok := lookup(name)
		value = strings.TrimSpace(value)
		if !ok || value == "" {
			return "", fmt.Errorf("%s is required", name)
		}
		return value, nil
	}

	mode, err := required("DEPLOY_MODE")
	if err != nil {
		return environmentConfig{}, err
	}
	if mode != "base" && mode != "pr" {
		return environmentConfig{}, errors.New("DEPLOY_MODE must be base or pr")
	}

	accountID, err := required("AWS_ACCOUNT_ID")
	if err != nil {
		return environmentConfig{}, err
	}
	region, err := required("AWS_REGION")
	if err != nil {
		return environmentConfig{}, err
	}
	vpcID, err := required("VPC_ID")
	if err != nil {
		return environmentConfig{}, err
	}
	subnetList, err := required("PUBLIC_SUBNET_IDS")
	if err != nil {
		return environmentConfig{}, err
	}
	subnetIDs := splitAndTrim(subnetList)
	if len(subnetIDs) < 2 {
		return environmentConfig{}, errors.New("PUBLIC_SUBNET_IDS must contain at least two subnets")
	}

	config := environmentConfig{
		DeployMode:      mode,
		AccountID:       accountID,
		Region:          region,
		VPCID:           vpcID,
		PublicSubnetIDs: subnetIDs,
	}
	if mode == "base" {
		return config, nil
	}

	prNumberValue, err := required("PR_NUMBER")
	if err != nil {
		return environmentConfig{}, err
	}
	prNumber, err := strconv.Atoi(prNumberValue)
	if err != nil || prNumber < 1 || prNumber > 50000 {
		return environmentConfig{}, errors.New("PR_NUMBER must be a number between 1 and 50000")
	}
	config.PRNumber = prNumber
	config.ImageURI, err = required("IMAGE_URI")
	if err != nil {
		return environmentConfig{}, err
	}
	config.TaskExecutionRoleARN, err = required("ECS_TASK_EXECUTION_ROLE_ARN")
	if err != nil {
		return environmentConfig{}, err
	}
	config.DatabaseSecretARN, err = required("DATABASE_SECRET_ARN")
	if err != nil {
		return environmentConfig{}, err
	}
	config.AuroraSecurityGroupID, err = required("AURORA_SECURITY_GROUP_ID")
	if err != nil {
		return environmentConfig{}, err
	}
	return config, nil
}

func splitAndTrim(value string) []string {
	var values []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			values = append(values, item)
		}
	}
	return values
}

func newBaseStack(scope constructs.Construct, id string, props *awscdk.StackProps, config environmentConfig) awscdk.Stack {
	stack := awscdk.NewStack(scope, jsii.String(id), props)
	addProjectTags(stack, "preview-base")

	albSecurityGroup := newResource(stack, "PreviewALBSecurityGroup", "AWS::EC2::SecurityGroup", map[string]interface{}{
		"GroupDescription": "Allow public HTTP traffic to the shared PR preview ALB",
		"VpcId":            config.VPCID,
		"SecurityGroupIngress": []interface{}{
			map[string]interface{}{"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80, "CidrIp": "0.0.0.0/0"},
		},
		"SecurityGroupEgress": []interface{}{
			map[string]interface{}{"IpProtocol": "-1", "CidrIp": "0.0.0.0/0"},
		},
		"Tags": resourceTags("github-profile-preview-alb"),
	})

	loadBalancer := newResource(stack, "PreviewLoadBalancer", "AWS::ElasticLoadBalancingV2::LoadBalancer", map[string]interface{}{
		"Name":           "github-profile-preview",
		"Scheme":         "internet-facing",
		"SecurityGroups": []interface{}{albSecurityGroup.Ref()},
		"Subnets":        stringInterfaces(config.PublicSubnetIDs),
		"Type":           "application",
		"Tags":           resourceTags("github-profile-preview-alb"),
	})

	listener := newResource(stack, "PreviewHTTPListener", "AWS::ElasticLoadBalancingV2::Listener", map[string]interface{}{
		"DefaultActions": []interface{}{
			map[string]interface{}{
				"Type": "fixed-response",
				"FixedResponseConfig": map[string]interface{}{
					"ContentType": "application/json",
					"MessageBody": `{"message":"unknown preview host"}`,
					"StatusCode":  "404",
				},
			},
		},
		"LoadBalancerArn": loadBalancer.Ref(),
		"Port":            80,
		"Protocol":        "HTTP",
	})

	cluster := newResource(stack, "PreviewCluster", "AWS::ECS::Cluster", map[string]interface{}{
		"ClusterName": "github-profile-preview-cluster",
		"ClusterSettings": []interface{}{
			map[string]interface{}{"Name": "containerInsights", "Value": "enabled"},
		},
		"Tags": resourceTags("github-profile-preview-cluster"),
	})

	newExport(stack, "ClusterName", cluster.Ref(), exportClusterName)
	newExport(stack, "HTTPListenerARN", listener.Ref(), exportHTTPListenerARN)
	newExport(stack, "LoadBalancerSecurityGroupID", albSecurityGroup.Ref(), exportLoadBalancerSGID)
	newExport(stack, "LoadBalancerDNSName", loadBalancer.GetAtt(jsii.String("DNSName"), awscdk.ResolutionTypeHint_STRING).ToString(), exportLoadBalancerDNSName)
	newExport(stack, "VPCID", jsii.String(config.VPCID), exportVPCID)
	newExport(stack, "PublicSubnetIDs", jsii.String(strings.Join(config.PublicSubnetIDs, ",")), exportPublicSubnetIDs)
	return stack
}

func newPRStack(scope constructs.Construct, id string, props *awscdk.StackProps, config environmentConfig) awscdk.Stack {
	stack := awscdk.NewStack(scope, jsii.String(id), props)
	addProjectTags(stack, fmt.Sprintf("pr-%d", config.PRNumber))

	vpcID := awscdk.Fn_ImportValue(jsii.String(exportVPCID))
	publicSubnetIDs := awscdk.Fn_Split(
		jsii.String(","),
		awscdk.Fn_ImportValue(jsii.String(exportPublicSubnetIDs)),
		nil,
	)
	albSecurityGroupID := awscdk.Fn_ImportValue(jsii.String(exportLoadBalancerSGID))
	clusterName := awscdk.Fn_ImportValue(jsii.String(exportClusterName))
	listenerARN := awscdk.Fn_ImportValue(jsii.String(exportHTTPListenerARN))
	resourceName := fmt.Sprintf("github-profile-pr-%d", config.PRNumber)

	serviceSecurityGroup := newResource(stack, "ServiceSecurityGroup", "AWS::EC2::SecurityGroup", map[string]interface{}{
		"GroupDescription": fmt.Sprintf("Allow only the preview ALB to reach PR %d", config.PRNumber),
		"VpcId":            vpcID,
		"SecurityGroupIngress": []interface{}{
			map[string]interface{}{
				"IpProtocol":            "tcp",
				"FromPort":              applicationContainerPort,
				"ToPort":                applicationContainerPort,
				"SourceSecurityGroupId": albSecurityGroupID,
			},
		},
		"SecurityGroupEgress": []interface{}{
			map[string]interface{}{"IpProtocol": "-1", "CidrIp": "0.0.0.0/0"},
		},
		"Tags": resourceTags(resourceName),
	})

	newResource(stack, "AuroraIngressFromPreviewService", "AWS::EC2::SecurityGroupIngress", map[string]interface{}{
		"GroupId":               config.AuroraSecurityGroupID,
		"IpProtocol":            "tcp",
		"FromPort":              5432,
		"ToPort":                5432,
		"SourceSecurityGroupId": serviceSecurityGroup.Ref(),
		"Description":           fmt.Sprintf("Allow PR %d Go service to read PostgreSQL", config.PRNumber),
	})

	logGroup := newResource(stack, "ApplicationLogGroup", "AWS::Logs::LogGroup", map[string]interface{}{
		"LogGroupName":    fmt.Sprintf("/ecs/github-profile/pr-%d", config.PRNumber),
		"RetentionInDays": 7,
		"Tags":            resourceTags(resourceName),
	})

	taskDefinition := newResource(stack, "TaskDefinition", "AWS::ECS::TaskDefinition", map[string]interface{}{
		"Cpu":                     "256",
		"Memory":                  "512",
		"ExecutionRoleArn":        config.TaskExecutionRoleARN,
		"Family":                  resourceName,
		"NetworkMode":             "awsvpc",
		"RequiresCompatibilities": []interface{}{"FARGATE"},
		"RuntimePlatform": map[string]interface{}{
			"CpuArchitecture":       "X86_64",
			"OperatingSystemFamily": "LINUX",
		},
		"ContainerDefinitions": []interface{}{
			map[string]interface{}{
				"Name":      applicationContainerName,
				"Image":     config.ImageURI,
				"Essential": true,
				"Secrets": []interface{}{
					map[string]interface{}{"Name": "DATABASE_URL", "ValueFrom": config.DatabaseSecretARN},
				},
				"Environment": []interface{}{
					map[string]interface{}{"Name": "CORS_ORIGIN", "Value": "*"},
					map[string]interface{}{"Name": "DATABASE_SSL_CA_PATH", "Value": "/etc/ssl/certs/aws-rds-global-bundle.pem"},
				},
				"PortMappings": []interface{}{
					map[string]interface{}{"ContainerPort": applicationContainerPort, "Protocol": "tcp"},
				},
				"LogConfiguration": map[string]interface{}{
					"LogDriver": "awslogs",
					"Options": map[string]interface{}{
						"awslogs-group":         logGroup.Ref(),
						"awslogs-region":        config.Region,
						"awslogs-stream-prefix": "api",
					},
				},
			},
		},
		"Tags": resourceTags(resourceName),
	})

	targetGroup := newResource(stack, "TargetGroup", "AWS::ElasticLoadBalancingV2::TargetGroup", map[string]interface{}{
		"HealthCheckEnabled":  true,
		"HealthCheckPath":     "/healthz",
		"HealthCheckProtocol": "HTTP",
		"Matcher":             map[string]interface{}{"HttpCode": "200"},
		"Name":                fmt.Sprintf("github-pr-%d", config.PRNumber),
		"Port":                applicationContainerPort,
		"Protocol":            "HTTP",
		"TargetGroupAttributes": []interface{}{
			map[string]interface{}{
				"Key":   "deregistration_delay.timeout_seconds",
				"Value": "10",
			},
		},
		"TargetType": "ip",
		"VpcId":      vpcID,
		"Tags":       resourceTags(resourceName),
	})

	service := newResource(stack, "Service", "AWS::ECS::Service", map[string]interface{}{
		"Cluster":                       clusterName,
		"DesiredCount":                  1,
		"LaunchType":                    "FARGATE",
		"PlatformVersion":               "LATEST",
		"TaskDefinition":                taskDefinition.Ref(),
		"HealthCheckGracePeriodSeconds": 60,
		"DeploymentConfiguration": map[string]interface{}{
			"MaximumPercent":        200,
			"MinimumHealthyPercent": 0,
		},
		"LoadBalancers": []interface{}{
			map[string]interface{}{
				"ContainerName":  applicationContainerName,
				"ContainerPort":  applicationContainerPort,
				"TargetGroupArn": targetGroup.Ref(),
			},
		},
		"NetworkConfiguration": map[string]interface{}{
			"AwsvpcConfiguration": map[string]interface{}{
				"AssignPublicIp": "ENABLED",
				"SecurityGroups": []interface{}{serviceSecurityGroup.Ref()},
				"Subnets":        publicSubnetIDs,
			},
		},
		"ServiceName": resourceName,
		"Tags":        resourceTags(resourceName),
	})

	listenerRule := newResource(stack, "PreviewHeaderListenerRule", "AWS::ElasticLoadBalancingV2::ListenerRule", map[string]interface{}{
		"Actions": []interface{}{
			map[string]interface{}{"Type": "forward", "TargetGroupArn": targetGroup.Ref()},
		},
		"Conditions": []interface{}{
			map[string]interface{}{
				"Field": "http-header",
				"HttpHeaderConfig": map[string]interface{}{
					"HttpHeaderName": "X-Preview-PR",
					"Values":         []interface{}{strconv.Itoa(config.PRNumber)},
				},
			},
		},
		"ListenerArn": listenerARN,
		"Priority":    config.PRNumber,
	})
	service.AddDependency(listenerRule)

	return stack
}

func newResource(stack awscdk.Stack, id, resourceType string, properties map[string]interface{}) awscdk.CfnResource {
	return awscdk.NewCfnResource(stack, jsii.String(id), &awscdk.CfnResourceProps{
		Type:       jsii.String(resourceType),
		Properties: &properties,
	})
}

func newExport(stack awscdk.Stack, id string, value *string, exportName string) {
	awscdk.NewCfnOutput(stack, jsii.String(id), &awscdk.CfnOutputProps{
		Value:      value,
		ExportName: jsii.String(exportName),
	})
}

func addProjectTags(stack awscdk.Stack, environment string) {
	awscdk.Tags_Of(stack).Add(jsii.String("Project"), jsii.String("github-profile-go"), nil)
	awscdk.Tags_Of(stack).Add(jsii.String("Environment"), jsii.String(environment), nil)
}

func resourceTags(name string) []interface{} {
	return []interface{}{
		map[string]interface{}{"Key": "Name", "Value": name},
		map[string]interface{}{"Key": "Project", "Value": "github-profile-go"},
	}
}

func stringInterfaces(values []string) []interface{} {
	result := make([]interface{}, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

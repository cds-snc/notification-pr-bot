function getRepoDefaults(targetRepo, awsEcrUrl) {
  const manifestsProjects = [
    {
      repoName: "notification-api",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "API_DOCKER_TAG",
      ecrUrl: awsEcrUrl,
      ecrName: "notify-api",
    },
    {
      repoName: "notification-admin",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "ADMIN_DOCKER_TAG",
      ecrUrl: awsEcrUrl,
      ecrName: "notify-admin",
    },
    {
      repoName: "notification-document-download-api",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "DOCUMENT_DOWNLOAD_DOCKER_TAG",
      ecrUrl: awsEcrUrl,
      ecrName: "notify-document-download-api",
    },
    {
      repoName: "notification-documentation",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "DOCUMENTATION_DOCKER_TAG",
      ecrUrl: awsEcrUrl,
      ecrName: "notify-documentation",
    },
    {
      repoName: "notification-lambdas",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "SES_RECEIVING_EMAILS_DOCKER_TAG",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com",
      ecrName: "notify/ses_receiving_emails",
    },
    {
      repoName: "notification-lambdas",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "SNS_TO_SQS_SMS_CALLBACKS_DOCKER_TAG",
      ecrUrl: awsEcrUrl,
      ecrName: "notify/sns_to_sqs_sms_callbacks",
    },
    {
      repoName: "notification-lambdas",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "BLAZER_DOCKER_TAG",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com",
      ecrName: "database-tools/blazer",
    },
    {
      repoName: "notification-lambdas",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "GOOGLE_CIDR_DOCKER_TAG",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com",
      ecrName: "lambda/google-cidr",
    },
    {
      repoName: "notification-lambdas",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "HEARTBEAT_DOCKER_TAG",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com",
      ecrName: "notify/heartbeat",
    },
    {
      repoName: "notification-lambdas",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "PINPOINT_TO_SQS_SMS_CALLBACKS_DOCKER_TAG",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com",
      ecrName: "notify/pinpoint_to_sqs_sms_callbacks",
    },
    {
      repoName: "notification-lambdas",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "SES_TO_SQS_EMAIL_CALLBACKS_DOCKER_TAG",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com",
      ecrName: "notify/ses_to_sqs_email_callbacks",
    },
    {
      repoName: "notification-lambdas",
      helmfileOverride: "helmfile/overrides/production.env",
      helmfileTagKey: "SYSTEM_STATUS_DOCKER_TAG",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com",
      ecrName: "notify/system_status",
    },
  ];

  const manifestsLambdas = [
    {
      repoName: "notification-lambdas",
      manifestFile: ".github/workflows/helmfile_production_apply.yaml",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
      ecrName: "heartbeat",
    },
    {
      repoName: "notification-lambdas",
      manifestFile: ".github/workflows/helmfile_production_apply.yaml",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
      ecrName: "system_status",
    },
    {
      repoName: "notification-lambdas",
      manifestFile: ".github/workflows/helmfile_production_apply.yaml",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
      ecrName: "ses_to_sqs_email_callbacks",
    },
  ];

  const defaultsByRepo = {
    "notification-manifests": {
      titlePrefix: "[AUTO-PR]",
      prTemplatePath: ".github/release_pr_template.md",
      projects: manifestsProjects,
      projectsLambdas: manifestsLambdas,
    },
    "notification-terraform": {
      titlePrefix: "[AUTO-PR]",
      prTemplatePath: ".github/release_pr_template.md",
      projects: [],
      projectsLambdas: [],
    },
  };

  return defaultsByRepo[targetRepo] || defaultsByRepo["notification-manifests"];
}

module.exports = { getRepoDefaults };

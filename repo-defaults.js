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
  ];

  const manifestsLambdas = [
    {
      repoName: "notification-api",
      manifestFile: ".github/workflows/helmfile_production_apply.yaml",
      ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
      ecrName: "api-lambda",
    },
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

const Base64 = require("js-base64").Base64;

const { AWS_ECR_URL, closePRs, createPR, getContents, getHeadSha } = require("./github")

// Images to update ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const PROJECTS = [
  {
    repoName: "notification-api",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "API_DOCKER_TAG",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-api",
  },
  {
    repoName: "notification-admin",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "ADMIN_DOCKER_TAG",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-admin",
  },
  {
    repoName: "notification-document-download-api",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "DOCUMENT_DOWNLOAD_DOCKER_TAG",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-document-download-api",
  },
  {
    repoName: "notification-documentation",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "DOCUMENTATION_DOCKER_TAG",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-documentation",
  },
];

const PROJECTS_LAMBDAS = [
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
    ecrName: "ses_to_sqs_email_callbacks",
  },
]

// Shas ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

function shortSha(fullSha) {
    return fullSha.slice(0, 7);
  }
  
  function getLatestImageUrl(projects, projectName, headSha) {
    const ecrUrl = projects.filter(project => project["ecrName"] == projectName)[0].ecrUrl
    return `${ecrUrl}/${projectName}:${shortSha(headSha)}`;
  }
  
  function getSha(project, content) {
    const helmfileRe = new RegExp(`${project.helmfileTagKey}: "(.*?)"`, "g")
    const result = content.match(helmfileRe)[0]
    const tagShaRe = new RegExp(`"(.*?)"`, "g")
    var tag = result.match(tagShaRe)[0]
    tag = tag.replaceAll("\"","");
    return tag;
  
  }
  
  function getLambdaSha(imageName) {
    return imageName.split(":").slice(-1)[0];
  }
  
  async function hydrateWithSHAs(projects) {
    return await Promise.all(
      projects.map(async (project) => {
        project.headSha = await getHeadSha(project.repoName);
        project.shortSha = shortSha(project.headSha)
        project.headUrl = getLatestImageUrl(
          projects,
          project.ecrName,
          project.headSha
        );
  
        // Patch the helmfile tags
        const helmfileContent = await getContents(
          "notification-manifests",
          project.helmfileOverride
        );
  
        const helmfileContents = Base64.decode(helmfileContent.content)
        
        project.oldSha = getSha(project, helmfileContents);
  
        return project;
      })
    );
  }
  
  async function hydrateLambdasWithSHAs(projects) {
    return await Promise.all(
      projects.map(async (project) => {
        project.headSha = await getHeadSha(project.repoName);
        project.shortSha = shortSha(project.headSha)
        project.headUrl = getLatestImageUrl(
          projects,
          project.ecrName,
          project.headSha
        );
  
        const releaseContent = await getContents(
          "notification-manifests",
          project.manifestFile
        );
  
        const originalFileContents = Base64.decode(releaseContent.content)
        const re = new RegExp(`${project.ecrName}:\\S*`, "g");
        project.oldUrl = originalFileContents.match(re)[0]
        project.oldSha = getLambdaSha(project.oldUrl);
        return project;
      })
    );
  }
  
  function updateHelmfileSha(content,project) {
    let re = new RegExp(String.raw`${project.helmfileTagKey}: "(.*?)"`, "g");
    return content.replace(re, `${project.helmfileTagKey}: "${shortSha(project.headSha)}"`);
  }
  
  function updateLambdaSha(content, project) {
    return content.replace(`${project.ecrName}:${project.oldSha}`, `${project.ecrName}:${shortSha(project.headSha)}`)
  }

// HELMFILE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

/**
 * Main function to automate the creation of PRs for updating container image tags in manifests
 * 
 * @param {boolean} closePRsFirst - Whether to close existing PRs with the same title prefix before creating a new one
 * @param {string} titlePrefix - Prefix for the PR title, e.g. "[AUTO-PR]"
 * @param {Array} projects - Array of regular service projects requiring Helmfile updates
 * @param {Array} projects_lambdas - Array of Lambda projects requiring manifest updates
 */
async function main(closePRsFirst, titlePrefix, projects, projects_lambdas) {
  // Get the PR template content from the manifests repo
  const prTemplate = await getContents(
    "notification-manifests",
    ".github/PULL_REQUEST_TEMPLATE.md"
  );
  const issueContent = Base64.decode(prTemplate.content);

  // Fetch the latest SHAs for all projects and update project objects with this information
  await hydrateWithSHAs(projects);
  await hydrateLambdasWithSHAs(projects_lambdas);

  // Group projects by the Helmfile they modify to avoid multiple updates to the same file
  const reducer = (previous, project) => ({ ...previous, [project.helmfileOverride]: (previous[project.helmfileOverride] || []).concat(project) })
  const projectsForFiles = projects.reduce(reducer, {})

  // For each Helmfile, prepare the changes needed by updating the SHA for each project
  var changesToHelmfile = Object.entries(projectsForFiles).map(async ([helmfileOverride, projectsForFile]) => {
    // Get the current content of the Helmfile
    const releaseContent = await getContents(
      "notification-manifests",
      helmfileOverride
    );

    // Decode the Base64 content and update the SHA for each project
    var fileContents = Base64.decode(releaseContent.content)
    projectsForFile.forEach((project) => {
      fileContents = updateHelmfileSha(fileContents, project)
    })

    // Encode the modified content back to Base64 and check if it actually changed
    const newReleaseContentBlob = Base64.encode(fileContents);
    const fileHasChanged = newReleaseContentBlob.trim() != releaseContent.content.trim()

    // Return all the information needed for the PR creation
    return { helmfileOverride, newReleaseContentBlob, releaseContent, fileHasChanged }
  })

  // Similar to regular projects, group Lambda projects by the manifest file they modify
  const lambdaReducer = (previous, project) => ({ ...previous, [project.manifestFile]: (previous[project.manifestFile] || []).concat(project) })
  const lambdaProjectsForFiles = projects_lambdas.reduce(lambdaReducer, {})

  // For each Lambda manifest file, prepare the changes needed by updating the SHA for each Lambda
  var changesToLambdaFiles = Object.entries(lambdaProjectsForFiles).map(async ([manifestFile, projectsForFile]) => {
    // Get the current content of the manifest file
    const releaseContent = await getContents(
      "notification-manifests",
      manifestFile
    );

    // Decode the Base64 content and update the SHA for each Lambda project
    var fileContents = Base64.decode(releaseContent.content)
    projectsForFile.forEach((project) => {
      fileContents = updateLambdaSha(fileContents, project)
    })

    // Encode the modified content back to Base64 and check if it actually changed
    const newReleaseContentBlob = Base64.encode(fileContents);
    const fileHasChanged = newReleaseContentBlob.trim() != releaseContent.content.trim()

    // Return all the information needed for the PR creation
    return { manifestFile, newReleaseContentBlob, releaseContent, fileHasChanged }
  })

  // Wait for all async operations to complete
  changesToHelmfile = await Promise.all(changesToHelmfile)
  changesToLambdaFiles = await Promise.all(changesToLambdaFiles)

  // Check if any files actually changed
  const helmFilesHaveChanged = changesToHelmfile.some(({ fileHasChanged }) => fileHasChanged)
  const lambdaFilesHaveChanged = changesToLambdaFiles.some(({ fileHasChanged }) => fileHasChanged)

  // Only create a PR if there are actually changes to be made
  if (helmFilesHaveChanged || lambdaFilesHaveChanged) {
    // If requested, close any existing PRs with the same title prefix
    if (closePRsFirst) {
      await closePRs(titlePrefix);
    }
    // Create the PR with all the changes
    await createPR(titlePrefix, projects, projects_lambdas, issueContent, changesToHelmfile, changesToLambdaFiles);
  }
}


// Main execute ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

main(true, "[AUTO-PR]", PROJECTS, PROJECTS_LAMBDAS);

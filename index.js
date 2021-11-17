const Base64 = require("js-base64").Base64;
const { AWS_ECR_URL, closePRs, createPR, getContents, getHeadSha } = require("./github")

// Images to update ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const PROJECTS = [
  {
    repoName: "notification-api",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-api",
  },
  {
    repoName: "notification-api",
    manifestFile: ".github/workflows/merge_to_main_production.yaml",
    ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
    ecrName: "api-lambda",
  },
  {
    repoName: "notification-admin",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-admin",
  },
  {
    repoName: "notification-document-download-api",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-document-download-api",
  },
  {
    repoName: "notification-document-download-frontend",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-document-download-frontend",
  },
  {
    repoName: "notification-documentation",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-documentation",
  },
];

// Logic ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

function shortSha(fullSha) {
  return fullSha.slice(0, 7);
}

function getSha(imageName) {
  return imageName.split(":").slice(-1)[0];
}

function getLatestImageUrl(projects, projectName, headSha) {
  const ecrUrl = projects.filter(project => project["ecrName"] == projectName)[0].ecrUrl
  return `${ecrUrl}/${projectName}:${shortSha(headSha)}`;
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

      const releaseContent = await getContents(
        "notification-manifests",
        project.manifestFile
      );

      const originalFileContents = Base64.decode(releaseContent.content)
      const re = new RegExp(`${project.ecrName}:\\S*`, "g");
      project.oldUrl = originalFileContents.match(re)[0]
      project.oldSha = getSha(project.oldUrl);
      return project;
    })
  );
}

function updateReleaseSha(content, project) {
  return content.replace(`${project.ecrName}:${project.oldSha}`, `${project.ecrName}:${shortSha(project.headSha)}`)
}

// Main ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function run(projects) {
  const prTemplate = await getContents(
    "notification-manifests",
    ".github/PULL_REQUEST_TEMPLATE.md"
  );
  const issueContent = Base64.decode(prTemplate.content);
  const manifestFiles = Array.from(new Set(projects.map(project => project.manifestFile)))

  await hydrateWithSHAs(projects);

  var changesToManifestFiles = manifestFiles.map(async (manifestFile) => {
    const projectsForFile = projects.filter(project => project.manifestFile == manifestFile)

    const releaseContent = await getContents(
      "notification-manifests",
      manifestFile
    );

    var fileContents = Base64.decode(releaseContent.content)
    projectsForFile.forEach((project) => {
      fileContents = updateReleaseSha(fileContents, project)
    })

    const newReleaseContentBlob = Base64.encode(fileContents);

    return { manifestFile, newReleaseContentBlob, releaseContent }
  })

  changesToManifestFiles = await Promise.all(changesToManifestFiles)

  // Return if no new changes.
  if (changesToManifestFiles.map(({ newReleaseContentBlob, releaseContent }) => {
    newReleaseContentBlob.trim() === releaseContent.content.trim()
  }).all) {
    return;
  }

  await closePRs();
  await createPR(projects, issueContent, changesToManifestFiles);
}

// Main execute ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
run(PROJECTS);

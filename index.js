const Base64 = require("js-base64").Base64;
const { GH_CDS, AWS_ECR_URL, closePRs, createPR, getContents, getHeadSha } = require("./githubUtils")

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

function getLatestImageUrl(PROJECTS, projectName, headSha) {
  const ecrUrl = PROJECTS.filter(project => project["ecrName"] == projectName)[0].ecrUrl
  return `${ecrUrl}/${projectName}:${shortSha(headSha)}`;
}

async function hydrateWithSHAs() {
  return await Promise.all(
    PROJECTS.map(async (project) => {
      project.headSha = await getHeadSha(project.repoName);
      project.shortSha = shortSha(project.headSha)
      project.headUrl = getLatestImageUrl(
        PROJECTS,
        project.ecrName,
        project.headSha
      );

      const releaseContent = await getContents(
        GH_CDS,
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

function UpdateContents(content, project) {
  return content.replace(`${project.ecrName}:${project.oldSha}`, `${project.ecrName}:${shortSha(project.headSha)}`)
}

// Main ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function run() {
  const prTemplate = await getContents(
    GH_CDS,
    "notification-manifests",
    ".github/PULL_REQUEST_TEMPLATE.md"
  );
  const issueContent = Base64.decode(prTemplate.content);
  const manifestFiles = Array.from(new Set(PROJECTS.map(project => project.manifestFile)))

  await hydrateWithSHAs();

  var changesToManifestFiles = manifestFiles.map(async (manifestFile) => {
    const projects = PROJECTS.filter(project => project.manifestFile == manifestFile)

    const releaseContent = await getContents(
      GH_CDS,
      "notification-manifests",
      manifestFile
    );

    var fileContents = Base64.decode(releaseContent.content)
    projects.forEach((project) => {
      fileContents = UpdateContents(fileContents, project)
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

  await closePRs(GH_CDS);
  await createPR(GH_CDS, PROJECTS, issueContent, changesToManifestFiles);
}

// Main execute ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
run();

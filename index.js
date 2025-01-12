const Base64 = require("js-base64").Base64;
const { AWS_ECR_URL, closePRs, createPR, getContents, getHeadSha } = require("./github")

// Images to update ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const PROJECTS = [
  {
    repoName: "notification-api",
    manifestFile: ".github/workflows/merge_to_main_production.yaml",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "API_DOCKER_TAG",
    ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
    ecrName: "api-lambda",
  },
  {
    repoName: "notification-api",
    manifestFile: "env/production/kustomization.yaml",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "API_DOCKER_TAG",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-api",
  },
  {
    repoName: "notification-admin",
    manifestFile: "env/production/kustomization.yaml",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "ADMIN_DOCKER_TAG",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-admin",
  },
  {
    repoName: "notification-document-download-api",
    manifestFile: "env/production/kustomization.yaml",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "DOCUMENT_DOWNLOAD_DOCKER_TAG",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-document-download-api",
  },
  {
    repoName: "notification-documentation",
    manifestFile: "env/production/kustomization.yaml",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "DOCUMENTATION_DOCKER_TAG",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-documentation",
  },
  // {
  //   repoName: "notification-lambdas",
  //   manifestFile: ".github/workflows/merge_to_main_production.yaml",
  //   ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
  //   ecrName: "system_status",
  // },
  // {
  //   repoName: "notification-lambdas",
  //   manifestFile: ".github/workflows/merge_to_main_production.yaml",
  //   ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
  //   ecrName: "heartbeat",
  // },
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

      // Patch the helmfile tags
      const helmfileContent = await getContents(
        "notification-manifests",
        project.helmfileOverride
      );

      const helmfileContents = Base64.decode(helmfileContent.content)

      const helmfileRe = new RegExp(`${project.helmfileTagKey}: "(.*?)"`, "g")
      project.oldHelmfileTag = helmfileContents.match(helmfileRe)[0]
      project.oldHelmfileSha = getSha(project.oldHelmfileTag);

      return project;
    })
  );
}

function updateReleaseSha(content, project) {
  return content.replace(`${project.ecrName}:${project.oldSha}`, `${project.ecrName}:${shortSha(project.headSha)}`)
}

function updateHelmfileSha(content,project) {
  
  let re = new RegExp(String.raw`${project.helmfileTagKey}: "(.*?)"`, "g");

  return content.replace(re, `${project.helmfileTagKey}: "${shortSha(project.headSha)}"`);
}

// Main ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function run(projects) {
  const prTemplate = await getContents(
    "notification-manifests",
    ".github/PULL_REQUEST_TEMPLATE.md"
  );
  const issueContent = Base64.decode(prTemplate.content);

  await hydrateWithSHAs(projects);

  const reducer = (previous, project) => ({ ...previous, [project.manifestFile]: (previous[project.manifestFile] || []).concat(project) })
  const projectsForFiles = projects.reduce(reducer, {})

  var changesToManifestFiles = Object.entries(projectsForFiles).map(async ([manifestFile, projectsForFile]) => {

    const releaseContent = await getContents(
      "notification-manifests",
      manifestFile
    );


    var fileContents = Base64.decode(releaseContent.content)
    projectsForFile.forEach((project) => {
      fileContents = updateReleaseSha(fileContents, project)
    })

    const newReleaseContentBlob = Base64.encode(fileContents);
    const fileHasChanged = newReleaseContentBlob.trim() != releaseContent.content.trim()

    return { manifestFile, newReleaseContentBlob, releaseContent, fileHasChanged }
  })
 
  changesToManifestFiles = await Promise.all(changesToManifestFiles)

  const filesHaveChanged = changesToManifestFiles.some(({ fileHasChanged }) => fileHasChanged)
  if (filesHaveChanged) {
    await closePRs();
    await createPR(projects, issueContent, changesToManifestFiles, false);
  }

}

// HELMFILE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function runHelmfile(projects) {
  const prTemplate = await getContents(
    "notification-manifests",
    ".github/PULL_REQUEST_TEMPLATE.md"
  );
  const issueContent = Base64.decode(prTemplate.content);

  await hydrateWithSHAs(projects);

  const reducer = (previous, project) => ({ ...previous, [project.helmfileOverride]: (previous[project.helmfileOverride] || []).concat(project) })
  const projectsForFiles = projects.reduce(reducer, {})

  var changesToHelmfile = Object.entries(projectsForFiles).map(async ([helmfileOverride, projectsForFile]) => {

    const releaseContent = await getContents(
      "notification-manifests",
      helmfileOverride
    );


    var fileContents = Base64.decode(releaseContent.content)
    projectsForFile.forEach((project) => {
      fileContents = updateHelmfileSha(fileContents, project)
    })

    const newReleaseContentBlob = Base64.encode(fileContents);
    const fileHasChanged = newReleaseContentBlob.trim() != releaseContent.content.trim()

    return { helmfileOverride, newReleaseContentBlob, releaseContent, fileHasChanged }
  })
 
  changesToHelmfile = await Promise.all(changesToHelmfile)

  const filesHaveChanged = changesToHelmfile.some(({ fileHasChanged }) => fileHasChanged)
  if (filesHaveChanged) {
    await createPR(projects, issueContent, changesToHelmfile, true);
  }
}


// Main execute ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

run(PROJECTS);
runHelmfile(PROJECTS);

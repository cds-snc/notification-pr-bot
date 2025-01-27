const Base64 = require("js-base64").Base64;
const { AWS_ECR_URL, closePRs, createPR, getContents, getHeadSha } = require("./github")

// Images to update ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const PROJECTS = [
  {
    repoName: "notification-api",
    helmfileOverride: "helmfile/overrides/production.env",
    helmfileTagKey: "API_DOCKER_TAG",
    ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
    ecrName: "api-lambda",
  },
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
  // {
  //   repoName: "notification-lambdas",
  //   ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
  //   ecrName: "system_status",
  // },
  // {
  //   repoName: "notification-lambdas",
  //   ecrUrl: "${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify",
  //   ecrName: "heartbeat",
  // },
];

// Logic ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

function shortSha(fullSha) {
  return fullSha.slice(0, 7);
}

function getLatestImageUrl(projects, projectName, headSha) {
  const ecrUrl = projects.filter(project => project["ecrName"] == projectName)[0].ecrUrl
  return `${ecrUrl}/${projectName}:${shortSha(headSha)}`;
}

function getSha(project, content) {

  const helmfileRe = new RegExp(`${project.helmfileTagKey}: "(.*?)"`, "g")
  result = content.match(helmfileRe)[0]
  const tagShaRe = new RegExp(`"(.*?)"`, "g")
  tag = result.match(tagShaRe)[0]
  tag = tag.replaceAll("\"","");
  
  return tag;

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
        project.helmfileOverride
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

function updateHelmfileSha(content,project) {
  
  let re = new RegExp(String.raw`${project.helmfileTagKey}: "(.*?)"`, "g");

  return content.replace(re, `${project.helmfileTagKey}: "${shortSha(project.headSha)}"`);
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
    await closePRs();
    await createPR(projects, issueContent, changesToHelmfile);
  }
}


// Main execute ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

runHelmfile(PROJECTS);

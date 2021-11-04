// Imports ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const fs = require('fs');
const github = require("@actions/github");
const Base64 = require("js-base64").Base64;
const YAML = require("yaml");
const process = require("process");

const {
  getContents,
  getHeadSha,
  getSha,
  getLatestImageUrl
} = require("./utils");

const { closePRs, createPR } = require("./prUtils")

// Environmment ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const myToken = process.env.TOKEN;
const octokit = new github.GitHub(myToken);

// Constants ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const GH_CDS = "cds-snc";
const AWS_ECR_URL = `public.ecr.aws/${GH_CDS}`;
const PRODUCTION_ECR_ACCOUNT = process.env.PRODUCTION_ECR_ACCOUNT

const PROJECTS = [
  {
    name: "notification-api",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-api",
  },
  // {
  //   name: "notification-admin",
  //   manifestFile: "images.yaml",  // TODO: add the real file
  //   ecrUrl: `${PRODUCTION_ECR_ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/notify`,
  //   ecrName: "api-lambda",
  // },
  {
    name: "notification-admin",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-admin",
  },
  {
    name: "notification-document-download-api",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-document-download-api",
  },
  {
    name: "notification-document-download-frontend",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-document-download-frontend",
  },
  {
    name: "notification-documentation",
    manifestFile: "env/production/kustomization.yaml",
    ecrUrl: AWS_ECR_URL,
    ecrName: "notify-documentation",
  },
];


async function hydrateWithSHAs(releaseConfig, projects) {
  return await Promise.all(
    releaseConfig.images.map(async (image) => {
      const matchingProject = projects.find((project) =>
        image.newName.includes(project.ecrName)
      );
      if (!matchingProject) {
        return null
      }
      matchingProject.headSha = await getHeadSha(matchingProject.name);
      matchingProject.headUrl = getLatestImageUrl(
        PROJECTS,
        matchingProject.ecrName,
        matchingProject.headSha
      );
      matchingProject.oldSha = getSha(image.newName);
      matchingProject.oldUrl = image.newName;
      image.newName = matchingProject.headUrl;
      return matchingProject;
    })
  );
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

  var changesToManifestFiles = manifestFiles.map(async (manifestFile) => {
    const projects = PROJECTS.filter(project => project.manifestFile == manifestFile)

    const releaseContent = await getContents(
      GH_CDS,
      "notification-manifests",
      manifestFile
    );
    const releaseConfig = YAML.parse(Base64.decode(releaseContent.content));

    // Build up projects and update images with latest SHAs.
    await hydrateWithSHAs(releaseConfig, projects);
    const newReleaseContentBlob = Base64.encode(YAML.stringify(releaseConfig));

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

  console.log("done")
}

// Main execute ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
run();

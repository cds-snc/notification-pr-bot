// Imports ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const github = require("@actions/github");
const process = require("process");

// Environmment ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const myToken = process.env.TOKEN;
const octokit = new github.GitHub(myToken);

// Constants ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const GH_CDS = "cds-snc";

// Logic ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function getContents(owner, repo, path) {
  const { data: data } = await octokit.repos.getContents({
    owner,
    repo,
    path,
  });
  return data;
}

const getHeadSha = async (repo) => {
  const { data: repoDetails } = await octokit.repos.get({
    owner: GH_CDS,
    repo,
  });
  const { data: repoBranch } = await octokit.repos.getBranch({
    owner: GH_CDS,
    repo,
    branch: repoDetails.default_branch,
  });
  return repoBranch.commit.sha;
};

const getLatestTag = async (repo) => {
  const {
    data: [latestTag],
  } = await octokit.repos.listTags({
    owner: GH_CDS,
    repo,
    per_page: 1,
  });

  return latestTag.name;
};
async function isNotLatestManifestsVersion() {
  const releaseConfig = await getContents(
    GH_CDS,
    "notification-manifests",
    "env/production/kustomization.yaml"
  );

  const releaseContent = Base64.decode(releaseConfig.content);
  const prodVersion = releaseContent.match(
    /notification-manifests\/\/base\?ref=(.*)/
  )[1];

  const latestVersion = await getLatestTag("notification-manifests");

  return prodVersion != latestVersion;
}

async function isNotLatestTerraformVersion() {
  const prodWorkflow = await getContents(
    GH_CDS,
    "notification-terraform",
    ".github/workflows/infrastructure_version.txt"
  );

  const prodVersion = Base64.decode(prodWorkflow.content).trim();
  const latestVersion = (await getLatestTag("notification-terraform")).replace(
    "v",
    ""
  );

  return prodVersion != latestVersion;
}

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

module.exports = {
  getContents,
  getHeadSha,
  getLatestTag,
  shortSha,
  getSha,
  getLatestImageUrl,
  isNotLatestManifestsVersion,
  isNotLatestTerraformVersion
};
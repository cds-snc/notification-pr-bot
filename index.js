// Imports ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const github = require("@actions/github");
const Base64 = require("js-base64").Base64;
const YAML = require("yaml");
const process = require("process");

// Environmment ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const myToken = process.env.TOKEN;
const octokit = new github.GitHub(myToken);

// Constants ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const GH_CDS = "cds-snc";
const AWS_ECR_URL = `public.ecr.aws/${GH_CDS}`;

const PROJECTS = [
  {
    name: "notification-api",
    ecrName: "notify-api",
    mainBranch: "master",
  },
  {
    name: "notification-admin",
    ecrName: "notify-admin",
    mainBranch: "master",
  },
  {
    name: "notification-document-download-api",
    ecrName: "notify-document-download-api",
    mainBranch: "master",
  },
  {
    name: "notification-document-download-frontend",
    ecrName: "notify-document-download-frontend",
    mainBranch: "master",
  },
  {
    name: "notification-documentation",
    ecrName: "notify-documentation",
    mainBranch: "main",
  },
];

// Logic ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const getCommitMessages = async (repo, sha) => {
  const { data: commits } = await octokit.repos.listCommits({
    owner: GH_CDS,
    repo,
    per_page: 50,
  });
  let index = 0;
  for (let i = 0; i < 50; i++) {
    if (commits[i].sha.startsWith(sha)) {
      index = i;
      break;
    }
  }
  return commits
    .slice(0, index)
    .map(
      (c) =>
        `- [${c.commit.message.split("\n\n")[0]}](${c.html_url}) by ${
          c.commit.author.name
        }`
    );
};

const getHeadSha = async (repo, branch = "master") => {
  const { data: repoBranch } = await octokit.repos.getBranch({
    owner: GH_CDS,
    repo,
    branch,
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

async function closePRs() {
  // Close old auto PRs
  const { data: prs } = await octokit.pulls.list({
    owner: GH_CDS,
    repo: "notification-manifests",
    state: "open",
  });

  prs.forEach(async (pr) => {
    if (pr.title.startsWith("[AUTO-PR]")) {
      await octokit.pulls.update({
        owner: GH_CDS,
        repo: "notification-manifests",
        pull_number: pr.number,
        state: "closed",
      });
      await octokit.git.deleteRef({
        owner: GH_CDS,
        repo: "notification-manifests",
        ref: `heads/${pr.head.ref}`,
      });
    }
  });
}

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
    ".github/workflows/merge_to_main_production.yml"
  );

  const workflowContent = Base64.decode(prodWorkflow.content);
  const prodVersion = workflowContent.match(
    /INFRASTRUCTURE_VERSION: '(.*)'/
  )[1];
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

function getLatestImageUrl(projectName, headSha) {
  return `${AWS_ECR_URL}/${projectName}:${shortSha(headSha)}`;
}

async function buildLogs(projects) {
  let logs = projects.map(async (project) => {
    const msgsCommits = await getCommitMessages(project.name, project.oldSha);
    const strCommits = msgsCommits.join("\n");
    const projectName = project.name.toUpperCase();
    return `${projectName}\n\n${strCommits}`;
  });
  logs = await Promise.all(logs);

  logs = logs.join("\n\n");
  if (await isNotLatestManifestsVersion()) {
    logs = `⚠️ **The production version of manifests is behind the latest staging version. Consider upgrading to the latest version before merging this pull request.** \n\n ${logs}`;
  }

  if (await isNotLatestTerraformVersion()) {
    logs = `⚠️ **The production version of the Terraform infrastructure is behind the latest staging version. Consider upgrading to the latest version before merging this pull request.** \n\n ${logs}`;
  }
  return logs;
}

async function getContents(owner, repo, path) {
  const { data: data } = await octokit.repos.getContents({
    owner,
    repo,
    path,
  });
  return data;
}

async function createPR(
  projects,
  issueContent,
  releaseConfig,
  newReleaseContentBlob
) {
  const branchName = `release-${new Date().getTime()}`;
  const manifestsSha = await getHeadSha("notification-manifests", "main");
  const logs = await buildLogs(projects);

  const ref = await octokit.git.createRef({
    owner: GH_CDS,
    repo: "notification-manifests",
    ref: `refs/heads/${branchName}`,
    sha: manifestsSha,
  });

  const manifestUpdates = projects
    .map((project) => {
      return `${project.name}:${shortSha(project.headSha)}`;
    })
    .join(" and ");
  const update = await octokit.repos.createOrUpdateFile({
    owner: GH_CDS,
    repo: "notification-manifests",
    branch: branchName,
    sha: releaseConfig.sha,
    path: "env/production/kustomization.yaml",
    message: `Updated manifests to ${manifestUpdates}`,
    content: newReleaseContentBlob,
  });

  const pr = await octokit.pulls.create({
    owner: GH_CDS,
    repo: "notification-manifests",
    title: `[AUTO-PR] Automatically generated new release ${new Date().toISOString()}`,
    head: branchName,
    base: "main",
    body: issueContent.replace(
      "> Give details ex. Security patching, content update, more API pods etc",
      logs
    ),
    draft: true,
  });
  return Promise.all([ref, update, pr]);
}

async function hydrateWithSHAs(releaseConfig, projects) {
  return await Promise.all(
    releaseConfig.images.map(async (image) => {
      const matchingProject = projects.find((project) =>
        image.newName.includes(project.ecrName)
      );
      matchingProject.headSha = await getHeadSha(
        matchingProject.name,
        matchingProject.mainBranch
      );
      matchingProject.headUrl = getLatestImageUrl(
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
  const releaseContent = await getContents(
    GH_CDS,
    "notification-manifests",
    "env/production/kustomization.yaml"
  );

  const prTemplate = await getContents(
    GH_CDS,
    "notification-manifests",
    ".github/PULL_REQUEST_TEMPLATE.md"
  );

  const releaseConfig = YAML.parse(Base64.decode(releaseContent.content));
  const issueContent = Base64.decode(prTemplate.content);

  // Build up projects and update images with latest SHAs.
  await hydrateWithSHAs(releaseConfig, PROJECTS);

  // Return if no new changes.
  const newReleaseContentBlob = Base64.encode(YAML.stringify(releaseConfig));
  if (newReleaseContentBlob.trim() === releaseContent.content.trim()) {
    return;
  }

  await closePRs();
  await createPR(PROJECTS, issueContent, releaseContent, newReleaseContentBlob);
}

// Main execute ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
run();

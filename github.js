const github = require("@actions/github");
const process = require("process");

// Constants ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const myToken = process.env.TOKEN;
const octokit = new github.GitHub(myToken);
const GH_CDS = "cds-snc";
const AWS_ECR_URL = `public.ecr.aws/${GH_CDS}`;

// Logic ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function closePRs() {
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

async function createPR(
  projects,
  issueContent,
  releaseContentArray
) {
  const branchName = `release-${new Date().getTime()}`;
  const manifestsSha = await getHeadSha("notification-manifests");
  const logs = await buildLogs(projects);

  const ref = await octokit.git.createRef({
    owner: GH_CDS,
    repo: "notification-manifests",
    ref: `refs/heads/${branchName}`,
    sha: manifestsSha,
  });

  const manifestUpdates = projects
    .map((project) => {
      return `${project.repoName}:${project.shortSha}`;
    })
    .join(" and ");

  for (const { manifestFile, releaseContent, newReleaseContentBlob } of releaseContentArray) {
    await octokit.repos.createOrUpdateFile({
      owner: GH_CDS,
      repo: "notification-manifests",
      branch: branchName,
      sha: releaseContent.sha,
      path: manifestFile,
      message: `Updated manifests to ${manifestUpdates}`,
      content: newReleaseContentBlob,
    })
  }

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
  return Promise.all([ref, pr]);
}

// given an array of objects and a key, return one item for each distinct value of the keys
function uniqueByKey(items, key) {
  return [...new Map(items.map(item => [item[key], item])).values()];
}

async function buildLogs(projects) {
  const uniqueByRepo = uniqueByKey(projects, "repoName");
  let logs = uniqueByRepo.map(async (project) => {
    const msgsCommits = await getCommitMessages(project.repoName, project.oldSha);
    const strCommits = msgsCommits.join("\n");
    const projectName = project.repoName.toUpperCase();
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
        `- [${c.commit.message.split("\n\n")[0]}](${c.html_url}) by ${c.commit.author.name
        }`
    );
};

async function getContents(repo, path) {
  const { data: data } = await octokit.repos.getContents({
    owner: GH_CDS,
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


module.exports = { GH_CDS, AWS_ECR_URL, closePRs, createPR, getContents, getHeadSha }

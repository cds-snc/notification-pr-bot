// Imports ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const github = require("@actions/github");
const process = require("process");

const {
  getHeadSha,
  shortSha,
  isNotLatestTerraformVersion,
  isNotLatestManifestsVersion
} = require("./utils");

// Environmment ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const myToken = process.env.TOKEN;
const octokit = new github.GitHub(myToken);

const GH_CDS = "cds-snc";


// Close old auto PRs
async function closePRs(owner) {
  const { data: prs } = await octokit.pulls.list({
    owner: owner,
    repo: "notification-manifests",
    state: "open",
  });

  prs.forEach(async (pr) => {
    if (pr.title.startsWith("SJA TEST [AUTO-PR]")) {
      await octokit.pulls.update({
        owner: owner,
        repo: "notification-manifests",
        pull_number: pr.number,
        state: "closed",
      });
      await octokit.git.deleteRef({
        owner: owner,
        repo: "notification-manifests",
        ref: `heads/${pr.head.ref}`,
      });
    }
  });
}


async function createPR(
  owner,
  projects,
  issueContent,
  releaseContentArray
) {
  const branchName = `release-${new Date().getTime()}`;
  const manifestsSha = await getHeadSha("notification-manifests");
  const logs = await buildLogs(projects);

  const ref = await octokit.git.createRef({
    owner: owner,
    repo: "notification-manifests",
    ref: `refs/heads/${branchName}`,
    sha: manifestsSha,
  });

  const manifestUpdates = projects
    .map((project) => {
      return `${project.name}:${shortSha(project.headSha)}`;
    })
    .join(" and ");

  const updates = releaseContentArray.map(async ({ manifestFile, releaseContent, newReleaseContentBlob }) => {
    return await octokit.repos.createOrUpdateFile({
      owner: owner,
      repo: "notification-manifests",
      branch: branchName,
      sha: releaseContent.sha,
      path: manifestFile,
      message: `Updated manifests to ${manifestUpdates}`,
      content: newReleaseContentBlob,
    })
  })
  await Promise.all(updates)

  const pr = await octokit.pulls.create({
    owner: owner,
    repo: "notification-manifests",
    title: `SJA TEST [AUTO-PR] Automatically generated new release ${new Date().toISOString()}`,
    head: branchName,
    base: "main",
    body: issueContent.replace(
      "> Give details ex. Security patching, content update, more API pods etc",
      logs
    ),
    draft: true,
  });
  return Promise.all([ref, pr] + updates);
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

module.exports = { closePRs, createPR }

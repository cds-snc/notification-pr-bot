// Imports ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const github = require("@actions/github");
const process = require("process");

// Environmment ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const myToken = process.env.TOKEN;
const octokit = new github.GitHub(myToken);

// Constants ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const GH_CDS = "cds-snc";

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
        `- [${c.commit.message.split("\n\n")[0]}](${c.html_url}) by ${c.commit.author.name
        }`
    );
};

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

module.exports = {
  getCommitMessages: getCommitMessages,
  getHeadSha: getHeadSha,
  getLatestTag: getLatestTag
};
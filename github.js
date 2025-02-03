const Base64 = require("js-base64").Base64;

const { Octokit } = require("@octokit/core");
const {
  restEndpointMethods,
} = require("@octokit/plugin-rest-endpoint-methods");
const process = require("process");

// Constants ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const myToken = process.env.TOKEN;
const MyOctokit = Octokit.plugin(restEndpointMethods);
const octokit = new MyOctokit({ auth: myToken });
const GH_CDS = "cds-snc";
const AWS_ECR_URL = `public.ecr.aws/${GH_CDS}`;

// Logic ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function closePRs(titlePrefix) {
  const { data: prs } = await octokit.rest.pulls.list({
    owner: GH_CDS,
    repo: "notification-manifests",
    state: "open",
  });

  prs.forEach(async (pr) => {
    if (pr.title.startsWith(titlePrefix)) {
      console.log(`Closing PR ${pr.title}`);
      await octokit.rest.pulls.update({
        owner: GH_CDS,
        repo: "notification-manifests",
        pull_number: pr.number,
        state: "closed",
      });
      await octokit.rest.git.deleteRef({
        owner: GH_CDS,
        repo: "notification-manifests",
        ref: `heads/${pr.head.ref}`,
      });
    }
  });
}

async function createPR(
  titlePrefix,
  projects, projects_lambdas,
  issueContent,
  changesToHelmfile, changesToLambdaFiles,

) {
  const branchName = `release-${new Date().getTime()}`;
  const manifestsSha = await getHeadSha("notification-manifests");
  const logs = await buildLogs(projects);

  const ref = await octokit.rest.git.createRef({
    owner: GH_CDS,
    repo: "notification-manifests",
    ref: `refs/heads/${branchName}`,
    sha: manifestsSha,
  });

  const helmManifestUpdates = projects
    .map((project) => {
      return `${project.repoName}:${project.shortSha}`;
    })
    .join(" and ");

  for (const { helmfileOverride, releaseContent, newReleaseContentBlob } of changesToHelmfile) {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GH_CDS,
      repo: "notification-manifests",
      branch: branchName,
      sha: releaseContent.sha,
      path: helmfileOverride,
      message: `Updated manifests to ${helmManifestUpdates}`,
      content: newReleaseContentBlob,
    })
  }

  const lambdaManifestUpdates = projects_lambdas
    .map((project) => {
      return `${project.repoName}:${project.shortSha}`;
    })
    .join(" and ");

  for (const { manifestFile, releaseContent, newReleaseContentBlob } of changesToLambdaFiles) {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GH_CDS,
      repo: "notification-manifests",
      branch: branchName,
      sha: releaseContent.sha,
      path: manifestFile,
      message: `Updated manifests to ${lambdaManifestUpdates}`,
      content: newReleaseContentBlob,
    })
  }

  const title = `${titlePrefix} - Automatically generated new release ${new Date().toISOString()}`
  console.log(`Creating PR ${title}`);
  const pr = await octokit.rest.pulls.create({
    owner: GH_CDS,
    repo: "notification-manifests",
    title: title,
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
  const { data: commits } = await octokit.rest.repos.listCommits({
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
  const { data: data } = await octokit.rest.repos.getContent({
    owner: GH_CDS,
    repo,
    path,
  });
  return data;
}

const getHeadSha = async (repo) => {
  const { data: repoDetails } = await octokit.rest.repos.get({
    owner: GH_CDS,
    repo,
  });
  const { data: repoBranch } = await octokit.rest.repos.getBranch({
    owner: GH_CDS,
    repo,
    branch: repoDetails.default_branch,
  });
  return repoBranch.commit.sha;
};

const getLatestTag = async (repo) => {
  const {
    data: [latestTag],
  } = await octokit.rest.repos.listTags({
    owner: GH_CDS,
    repo,
    per_page: 1,
  });

  return latestTag.name;
};
async function isNotLatestManifestsVersion() {
  const releaseConfig = await getContents(
    "notification-manifests",
    "VERSION"
  );

  const prodVersion = Base64.decode(releaseConfig.content);
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

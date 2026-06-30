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
// TARGET_REPO is read from an environment variable so the same bot can be
// pointed at any cds-snc repository (e.g. notification-manifests or
// notification-terraform).  The default preserves the original behaviour.
const TARGET_REPO = process.env.TARGET_REPO || "notification-manifests";
const AWS_ECR_URL = `public.ecr.aws/${GH_CDS}`;

// Logic ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function closePRs(titlePrefix) {
  const { data: prs } = await octokit.rest.pulls.list({
    owner: GH_CDS,
    repo: TARGET_REPO,
    state: "open",
  });

  for (const pr of prs) {
    if (pr.title.startsWith(titlePrefix)) {
      console.log(`Closing PR ${pr.title}`);
      await octokit.rest.pulls.update({
        owner: GH_CDS,
        repo: TARGET_REPO,
        pull_number: pr.number,
        state: "closed",
      });
      await octokit.rest.git.deleteRef({
        owner: GH_CDS,
        repo: TARGET_REPO,
        ref: `heads/${pr.head.ref}`,
      });
    }
  }
}

const GENERATED_SUMMARY_PLACEHOLDER = "<!-- RELEASE_SUMMARY -->";

function injectGeneratedContent(issueContent, logs) {
  // Prefer the shared summary placeholder used by release templates.
  if (issueContent.includes(GENERATED_SUMMARY_PLACEHOLDER)) {
    return issueContent.replace(GENERATED_SUMMARY_PLACEHOLDER, logs);
  }

  // Backward compatibility for legacy templates that predate RELEASE_SUMMARY.
  return issueContent
    .replace(
      "> What is changing and why? (e.g. security patching, scaling API pods, new feature deployment)",
      logs
    )
    .replace(
      "> Give details ex. Security patching, content update, more API pods etc",
      logs
    )
    .replace("_TODO: 1-3 sentence description of the changed you're proposing._", logs);
}

async function createPR(
  titlePrefix,
  projects,
  issueContent,
  changesToHelmfile,
  extraFileChanges,
) {
  const branchName = `release-${new Date().getTime()}`;
  const targetRepoSha = await getHeadSha(TARGET_REPO);
  // pass in the projects so that the changes for all repos will be listed in the PR
  const logs = await buildLogs(projects, extraFileChanges);

  const ref = await octokit.rest.git.createRef({
    owner: GH_CDS,
    repo: TARGET_REPO,
    ref: `refs/heads/${branchName}`,
    sha: targetRepoSha,
  });

  const changedHelmfileUpdates = changesToHelmfile.filter(({ fileHasChanged }) => fileHasChanged);

  const helmManifestUpdates = projects
    .map((project) => {
      return `${project.repoName}:${project.shortSha}`;
    })
    .join(" and ");

  for (const { helmfileOverride, releaseContent, newReleaseContentBlob } of changedHelmfileUpdates) {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GH_CDS,
      repo: TARGET_REPO,
      branch: branchName,
      sha: releaseContent.sha,
      path: helmfileOverride,
      message: `Updated manifests to ${helmManifestUpdates}`,
      content: newReleaseContentBlob,
    })
  }

  for (const {
    filePath,
    releaseContent,
    newReleaseContentBlob,
    commitMessage,
  } of extraFileChanges) {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GH_CDS,
      repo: TARGET_REPO,
      branch: branchName,
      sha: releaseContent.sha,
      path: filePath,
      message: commitMessage,
      content: newReleaseContentBlob,
    });
  }

  const title = `${titlePrefix} - Automatically generated new release ${new Date().toISOString()}`
  console.log(`Creating PR ${title}`);
  const pr = await octokit.rest.pulls.create({
    owner: GH_CDS,
    repo: TARGET_REPO,
    title: title,
    head: branchName,
    base: "main",
    body: injectGeneratedContent(issueContent, logs),
    draft: true,
  });
  return Promise.all([ref, pr]);
}

// given an array of objects and a key, return one item for each distinct value of the keys
function uniqueByKey(items, key) {
  return [...new Map(items.map(item => [item[key], item])).values()];
}

function escapeTableCell(content) {
  return String(content).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function getCommitSummaryLine(commit, componentLabel) {
  const prMatch = commit.message.match(/\(#(\d+)\)/);
  const cleanMessage = commit.message.replace(/\s*\(#\d+\)$/, "");

  if (prMatch) {
    const prNumber = prMatch[1];
    const prUrl = `https://github.com/${GH_CDS}/${commit.repoName}/pull/${prNumber}`;
    return `- [#${prNumber}](${prUrl}) - ${cleanMessage} — ${commit.authorName} [${componentLabel}]`;
  }

  return `- [commit](${commit.url}) - ${cleanMessage} — ${commit.authorName} [${componentLabel}]`;
}

function getCommitTableLine(commit) {
  const safeMessage = escapeTableCell(commit.message);
  const safeAuthor = escapeTableCell(commit.authorName);
  return `- [${safeMessage}](${commit.url}) by ${safeAuthor}`;
}

async function buildLogs(projects, extraFileChanges = []) {
  const uniqueByRepo = uniqueByKey(projects, "repoName");
  let logs = "";

  if (uniqueByRepo.length > 0) {
    const repoCommitGroups = await Promise.all(
      uniqueByRepo.map(async (project) => {
        const commits = await getCommitMessages(project.repoName, project.oldSha);
        return {
          componentLabel: project.repoName.toUpperCase(),
          commits,
        };
      })
    );

    const copyReadyLines = repoCommitGroups
      .flatMap(({ componentLabel, commits }) =>
        commits.map((commit) => getCommitSummaryLine(commit, componentLabel))
      )
      .join("\n");

    const copyReadySection = [
      "<details>",
      "<summary>Copy Rendered Summary</summary>",
      "",
      "NOTIFICATION-MANIFESTS",
      "",
      copyReadyLines,
      "</details>",
    ].join("\n");

    const tableHeader = "| Component | Changes |\n| --- | --- |";
    const tableRows = repoCommitGroups
      .sort((a, b) => a.componentLabel.localeCompare(b.componentLabel))
      .map(({ componentLabel, commits }) => {
        const commitLines = commits.length
          ? commits.map(getCommitTableLine).join("<br>")
          : "_No new commits_";
        return `| ${componentLabel} | ${commitLines} |`;
      })
      .join("\n");

    logs = `${copyReadySection}\n\n${tableHeader}\n${tableRows}`;
  }

  if (extraFileChanges.length > 0) {
    const tfChange = extraFileChanges.find(c => c.oldVersion);
    if (tfChange) {
      const commitLog = await getTerraformModuleCommitSummary(
        tfChange.oldVersion,
        tfChange.latestVersion
      );
      const extraSummary = [
        `Releasing Terraform infrastructure from \`${tfChange.oldVersion}\` to \`${tfChange.latestVersion}\`.`,
        commitLog,
      ].join("\n");
      logs = logs ? `${extraSummary}\n\n${logs}` : extraSummary;
    } else {
      const extraSummary = extraFileChanges
        .map(({ filePath, commitMessage }) => `- \`${filePath}\`: ${commitMessage}`)
        .join("\n");
      logs = logs ? `${extraSummary}\n\n${logs}` : extraSummary;
    }
  }

  if (!logs) {
    return "_No component-level changes detected in this release._";
  }

  return logs;
}

function getTerraformModuleFromPath(path) {
  const match = path.match(/^aws\/([^/]+)\//);
  return match ? match[1] : null;
}

function isTerraformReleaseCommitMessage(message) {
  const isRelease = /^release\s+\d+\.\d+\.\d+\s+\(#\d+\)$/i.test(message.trim());
  const isUpdateTracker = /^Update infrastructure version to\s+\d+\.\d+\.\d+.*$/i.test(message.trim());
  return isRelease || isUpdateTracker;
}

async function getTerraformModuleCommitSummary(oldVersion, latestVersion) {
  const oldTagRef = await getTagRef("notification-terraform", oldVersion);
  const latestTagRef = await getTagRef("notification-terraform", latestVersion);

  if (!oldTagRef || !latestTagRef) {
    return "_Could not resolve old or latest version tag._";
  }

  const { data: comparison } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner: GH_CDS,
    repo: "notification-terraform",
    basehead: `${oldTagRef}...${latestTagRef}`,
  });

  const moduleToCommits = new Map();

  const relevantCommits = (comparison.commits || []).filter((commit) => {
    const message = commit.commit.message.split("\n\n")[0];
    return !isTerraformReleaseCommitMessage(message);
  });

  if (relevantCommits.length > 0) {
    const commitEntries = await Promise.all(
      relevantCommits.map(async (commit) => {
        const { data: commitData } = await octokit.rest.repos.getCommit({
          owner: GH_CDS,
          repo: "notification-terraform",
          ref: commit.sha,
        });

        const modules = new Set(
          (commitData.files || [])
            .map((file) => getTerraformModuleFromPath(file.filename))
            .filter(Boolean)
        );

        if (modules.size === 0) {
          modules.add("other");
        }

        const authorName = commit.commit.author ? commit.commit.author.name : "Unknown";
        const message = commit.commit.message.split("\n\n")[0];
        const safeMessage = message.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
        const tableBullet = `- [${safeMessage}](${commit.html_url}) by ${authorName}`;

        return {
          modules,
          message,
          url: commit.html_url,
          authorName,
          tableBullet,
        };
      })
    );

    for (const { modules, tableBullet } of commitEntries) {
      for (const moduleName of modules) {
        const existing = moduleToCommits.get(moduleName) || [];
        existing.push(tableBullet);
        moduleToCommits.set(moduleName, existing);
      }
    }

    const commitToModules = new Map();
    for (const { modules, message, url, authorName } of commitEntries) {
      const key = `${url}|${message}`;
      const existing = commitToModules.get(key) || {
        message,
        url,
        authorName,
        modules: new Set(),
      };

      for (const moduleName of modules) {
        const moduleLabel = moduleName === "other" ? "Other" : moduleName;
        existing.modules.add(moduleLabel);
      }

      commitToModules.set(key, existing);
    }

    const copyReadyLines = [...commitToModules.values()]
      .map(({ message, url, authorName, modules }) => {
        const moduleList = [...modules].sort().join(", ");
        const prMatch = message.match(/\(#(\d+)\)/);
        const prNumber = prMatch ? prMatch[1] : null;
        const cleanMessage = message.replace(/\s*\(#\d+\)$/, "");
        if (prNumber) {
          const prUrl = `https://github.com/${GH_CDS}/notification-terraform/pull/${prNumber}`;
          return `- [#${prNumber}](${prUrl}) - ${cleanMessage} — ${authorName} [${moduleList}]`;
        }

        return `- [commit](${url}) - ${cleanMessage} — ${authorName} [${moduleList}]`;
      })
      .join("\n");

    const copyReadySection = [
      "<details>",
      "<summary>Copy Rendered Summary</summary>",
      "",
      "NOTIFICATION-TERRAFORM",
      "",
      copyReadyLines,
      "</details>",
    ].join("\n");

    const sortedModules = [...moduleToCommits.keys()].sort();

    if (sortedModules.length === 0) {
      return "_No module-level changes detected in this release._";
    }

    const header = "| Module | Changes |\n| --- | --- |";
    const rows = sortedModules
      .map((moduleName) => {
        const moduleLabel = moduleName === "other" ? "Other" : moduleName;
        const commits = moduleToCommits.get(moduleName).join("<br>");
        return `| ${moduleLabel} | ${commits} |`;
      })
      .join("\n");

    const tableSection = `${header}\n${rows}`;
    return `${copyReadySection}\n\n${tableSection}`;
  }

  return "_No module-level changes detected in this release._";
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
    .map((c) => ({
      repoName: repo,
      message: c.commit.message.split("\n\n")[0],
      url: c.html_url,
      authorName: c.commit.author ? c.commit.author.name : "Unknown",
    }));
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

const getTagRef = async (repo, version) => {
  // version may be with or without leading 'v'
  const candidates = [version, `v${version}`];
  const { data: tags } = await octokit.rest.repos.listTags({
    owner: GH_CDS,
    repo,
    per_page: 50,
  });
  const tag = tags.find(t => candidates.includes(t.name));
  return tag ? tag.name : null;
};

const getLatestTag = async (repo) => {
  const {
    data: tags,
  } = await octokit.rest.repos.listTags({
    owner: GH_CDS,
    repo,
    per_page: 50,
  });

  // Filter for valid version tags (v1.2.3 or just 1.2.3 format)
  const versionTags = tags.filter(tag => {
    const name = tag.name;
    // Match patterns like v2.27.79, 2.27.79, v1.2.3, 1.2.3
    return /^v?\d+\.\d+\.\d+/.test(name);
  });

  if (versionTags.length === 0) {
    // Fallback to first tag if no valid versions found
    return tags[0]?.name || null;
  }

  // Return the first valid tag (GitHub API returns them in reverse chronological order)
  return versionTags[0].name;
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
  const terraformVersionChange = await getTerraformVersionChange();
  return terraformVersionChange && terraformVersionChange.fileHasChanged;
}

async function getTerraformVersionChange(force = false) {
  const prodWorkflow = await getContents(
    "notification-terraform",
    ".github/workflows/infrastructure_version.txt"
  );

  const prodVersion = Base64.decode(prodWorkflow.content).trim();
  const latestVersion = (await getLatestTag("notification-terraform")).replace(
    "v",
    ""
  );

  const fileHasChanged = force || prodVersion !== latestVersion;

  if (!fileHasChanged) {
    return null;
  }

  return {
    filePath: ".github/workflows/infrastructure_version.txt",
    releaseContent: prodWorkflow,
    newReleaseContentBlob: Base64.encode(`${latestVersion}\n`),
    fileHasChanged: true,
    oldVersion: prodVersion,
    latestVersion,
    commitMessage: `Update infrastructure version to ${latestVersion}`,
  };
}

module.exports = {
  GH_CDS,
  AWS_ECR_URL,
  TARGET_REPO,
  buildLogs,
  closePRs,
  createPR,
  getContents,
  getHeadSha,
  injectGeneratedContent,
  isNotLatestManifestsVersion,
  isNotLatestTerraformVersion,
  getTerraformVersionChange,
}

const github = require('@actions/github');
const Base64 = require('js-base64').Base64;
const YAML = require('yaml');

const myToken = process.env.TOKEN;
const octokit = new github.GitHub(myToken);

const getCommitMessages = async (repo, sha) => {
  const { data: commits } = await octokit.repos.listCommits({
    owner: "cds-snc",
    repo,
    per_page: 50
  });
  let index = 0;
  for(i = 0; i < 50; i++){
    if(commits[i].sha.startsWith(sha)){
      index = i;
      break;
    }
  }
  return commits.slice(0, index).map(c => `- [${c.commit.message.split("\n\n")[0]}](${c.html_url}) by ${c.commit.author.name}`)
}

const getHeadSha = async (repo, branch = 'master') => {
  const { data: data } = await octokit.repos.getBranch({
    owner: 'cds-snc',
    repo,
    branch,
  });
  return data.commit.sha;
}

const getLatestTag = async (repo) => {
  const {data: [latestTag]} = await octokit.repos.listTags({
    owner: 'cds-snc',
    repo,
    per_page: 1,
  });

  return latestTag.name;
}

async function closePRs() {
   // Close old auto PRs
   const {data: prs} = await octokit.pulls.list({
     owner: 'cds-snc',
     repo: 'notification-manifests',
     state: 'open'
   });

   prs.forEach( async pr => {
     if(pr.title.startsWith("[AUTO-PR]")) {
       await octokit.pulls.update({
         owner: 'cds-snc',
         repo: 'notification-manifests',
         pull_number: pr.number,
         state: "closed"
       });
       await octokit.git.deleteRef({
         owner: 'cds-snc',
         repo: 'notification-manifests',
         ref: `heads/${pr.head.ref}`
       });
     }
   })
}

async function isNotLatestManifestsVersion() {
    const { data: data } = await octokit.repos.getContents({
      owner: 'cds-snc',
      repo: 'notification-manifests',
      path: 'env/production/kustomization.yaml'
    });

    const fileContent = Base64.decode(data.content);
    const prodVersion = fileContent.match(/notification-manifests\/\/base\?ref=(.*)/)[1];

    const latestVersion = await getLatestTag('notification-manifests');

    return prodVersion != latestVersion;
}

async function isNotLatestTerraformVersion() {
    const { data: data } = await octokit.repos.getContents({
      owner: 'cds-snc',
      repo: 'notification-terraform',
      path: '.github/workflows/merge_to_main_production.yml'
    });

    const fileContent = Base64.decode(data.content);
    const prodVersion = fileContent.match(/INFRASTRUCTURE_VERSION: '(.*)'/)[1];

    const latestVersion = (await getLatestTag('notification-terraform')).replace('v', '');

    return prodVersion != latestVersion;
}

async function run() {
    const { data: data } = await octokit.repos.getContents({
      owner: 'cds-snc',
      repo: 'notification-manifests',
      path: 'env/production/kustomization.yaml'
    });

    const { data: issueData } = await octokit.repos.getContents({
      owner: 'cds-snc',
      repo: 'notification-manifests',
      path: '.github/PULL_REQUEST_TEMPLATE.md'
    });

    const apiSha = await getHeadSha("notification-api");
    const adminSha = await getHeadSha("notification-admin");
    const manifestsSha = await getHeadSha("notification-manifests", "main");

    fileContent = YAML.parse(Base64.decode(data.content));
    issueContent = Base64.decode(issueData.content);

    fileContent.images.forEach((image) => {
      if(image.name == "admin"){
        oldAdminSha = image.newName.split(":").slice(-1)[0]
        image.newName = `gcr.io/cdssnc/notify/admin:${adminSha.slice(0,7)}`
      }
      if(image.name == "api"){
        oldApiSha= image.newName.split(":").slice(-1)[0]
        image.newName = `gcr.io/cdssnc/notify/api:${apiSha.slice(0,7)}`
      }
    });

    const newBlob = Base64.encode(YAML.stringify(fileContent))

   if(newBlob !== data.content){
      closePRs()

      const adminMsgs = await getCommitMessages("notification-admin", oldAdminSha)
      const apiMsgs = await getCommitMessages("notification-api", oldApiSha)

      let logs = `ADMIN: \n\n ${adminMsgs.join("\n")} \n\n API: \n\n ${apiMsgs.join("\n")}`
      if (await isNotLatestManifestsVersion()) {
        logs = `⚠️ **The production version of manifests is behind the latest staging version. Consider upgrading to the latest version before merging this pull request.** \n\n ${logs}`
      }

      if (await isNotLatestTerraformVersion()) {
        logs = `⚠️ **The production version of the Terraform infrastructure is behind the latest staging version. Consider upgrading to the latest version before merging this pull request.** \n\n ${logs}`
      }

      branchName = `release-${new Date().getTime()}`

      await octokit.git.createRef({
        owner: 'cds-snc',
        repo: 'notification-manifests',
        ref: `refs/heads/${branchName}`,
        sha: manifestsSha
      });

      await octokit.repos.createOrUpdateFile({
        owner: 'cds-snc',
        repo: 'notification-manifests',
        branch: branchName,
        sha: data.sha,
        path: 'env/production/kustomization.yaml',
        message: `Updated manifests to admin:${adminSha.slice(0,7)} and api:${apiSha.slice(0,7)}`,
        content: newBlob
      })

      await octokit.pulls.create({
        owner: 'cds-snc',
        repo: 'notification-manifests',
        title: `[AUTO-PR] Automatically generated new release ${new Date().toISOString()}`,
        head: branchName,
        base: 'main',
        body: issueContent.replace("> Give details ex. Security patching, content update, more API pods etc", logs),
        draft: true
      });
  }
}
run();

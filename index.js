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

const getHeadSha = async (repo) => {
  const { data: data } = await octokit.repos.getBranch({
    owner: 'cds-snc',
    repo: repo,
    branch: 'master'
  });
  return data.commit.sha;
}

async function closePRs() {
   // Close old auto PRs
   const {data: prs} = await octokit.pulls.list({
     owner: 'cds-snc',
     repo: 'notification-tf',
     state: 'open'
   });

   prs.forEach( async pr => {
     if(pr.title.startsWith("[AUTO-PR]")) {
       await octokit.pulls.update({
         owner: 'cds-snc',
         repo: 'notification-tf',
         pull_number: pr.number,
         state: "closed"
       });
       await octokit.git.deleteRef({
         owner: 'cds-snc',
         repo: 'notification-tf',
         ref: `heads/${pr.head.ref}`
       });
     }
   })
}

async function hasChangesOnStagingTfRepo() {
    pullsSearchDefinition = {
        owner: 'cds-snc',
        sort: 'updated',
        direction: 'desc',
        // Not possible to target merged PRs, should filter on merged_at instead
        state: 'closed',
        page: 1
    }
    const prodPulls = await octokit.pulls.list({
        ...pullsSearchDefinition,
        repo: 'notification-tf',
    })
    const stagingPulls = await octokit.pulls.list({
        ...pullsSearchDefinition,
        repo: 'notification-staging-tf',
    })

    const mergedProdPulls = prodPulls['data'].filter(pr => pr.merged_at !== null);
    const mergedStagingPulls = stagingPulls['data'].filter(pr => pr.merged_at !== null);

    const prodLastProdPR = Date.parse(mergedProdPulls[0].merged_at);
    const stagingLastPR = Date.parse(mergedStagingPulls[0].merged_at);
    return stagingLastPR > prodLastProdPR;
}

async function run() {
    const { data: data } = await octokit.repos.getContents({
      owner: 'cds-snc',
      repo: 'notification-tf',
      path: 'manifests/overlays/eks/kustomization.yaml'
    });

    const { data: issueData } = await octokit.repos.getContents({
      owner: 'cds-snc',
      repo: 'notification-tf',
      path: '.github/PULL_REQUEST_TEMPLATE.md'
    });

    const apiSha = await getHeadSha("notification-api");
    const adminSha = await getHeadSha("notification-admin");
    const tfSha = await getHeadSha("notification-tf");

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
      if (await hasChangesOnStagingTfRepo()) {
        logs = `⚠️ There was a merged pull request in [notification-staging-tf](https://github.com/cds-snc/notification-staging-tf) since last deploy in production! Check first that you don't need to change the infrastructure here. \n\n ${logs}`
      }

      branchName = `release-${new Date().getTime()}`

      await octokit.git.createRef({
        owner: 'cds-snc',
        repo: 'notification-tf',
        ref: `refs/heads/${branchName}`,
        sha: tfSha
      });

      await octokit.repos.createOrUpdateFile({
        owner: 'cds-snc',
        repo: 'notification-tf',
        branch: branchName,
        sha: data.sha,
        path: 'manifests/overlays/eks/kustomization.yaml',
        message: `Updated manifests to admin:${adminSha.slice(0,7)} and api:${apiSha.slice(0,7)}`,
        content: newBlob
      })

      await octokit.pulls.create({
        owner: 'cds-snc',
        repo: 'notification-tf',
        title: `[AUTO-PR] Automatically generated new release ${new Date().toISOString()}`,
        head: branchName,
        base: 'master',
        body: issueContent.replace("> Give details ex. Security patching, content update, more API pods etc", logs),
        draft: true
      });
  }
}
run();

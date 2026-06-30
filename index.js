const Base64 = require("js-base64").Base64;
const process = require("process");

const {
  AWS_ECR_URL,
  TARGET_REPO,
  closePRs,
  createPR,
  getContents,
  getHeadSha,
  getTerraformVersionChange,
} = require("./github")
const { getRepoDefaults } = require("./repo-defaults")

// Configuration ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Values are provided via environment variables.

function getInput(name, defaultValue) {
  const envVar = process.env[name];
  if (envVar !== undefined && envVar !== "") return envVar;
  return defaultValue;
}

function getJsonInput(name, defaultValue) {
  const raw = getInput(name, null);
  if (raw === null) return defaultValue;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse ${name} as JSON: ${e.message}`);
    return defaultValue;
  }
}

// Images to update ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const repoDefaults = getRepoDefaults(TARGET_REPO, AWS_ECR_URL);
const TITLE_PREFIX = getInput("TITLE_PREFIX", repoDefaults.titlePrefix);
const PR_TEMPLATE_PATH = getInput("PR_TEMPLATE_PATH", repoDefaults.prTemplatePath);
const PROJECTS = getJsonInput("PROJECTS", repoDefaults.projects);

// Shas ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

function shortSha(fullSha) {
    return fullSha.slice(0, 7);
  }
  
  function getLatestImageUrl(projects, projectName, headSha) {
    const ecrUrl = projects.filter(project => project["ecrName"] == projectName)[0].ecrUrl
    return `${ecrUrl}/${projectName}:${shortSha(headSha)}`;
  }
  
  function getSha(project, content) {
    const helmfileRe = new RegExp(`${project.helmfileTagKey}: "(.*?)"`, "g")
    const result = content.match(helmfileRe)[0]
    const tagShaRe = new RegExp(`"(.*?)"`, "g")
    var tag = result.match(tagShaRe)[0]
    tag = tag.replaceAll("\"","");
    return tag;
  
  }
  
  async function hydrateWithSHAs(projects) {
    return await Promise.all(
      projects.map(async (project) => {
        project.headSha = await getHeadSha(project.repoName);
        project.shortSha = shortSha(project.headSha)
        project.headUrl = getLatestImageUrl(
          projects,
          project.ecrName,
          project.headSha
        );
  
        // Patch the helmfile tags
        const helmfileContent = await getContents(
          TARGET_REPO,
          project.helmfileOverride
        );
  
        const helmfileContents = Base64.decode(helmfileContent.content)
        
        project.oldSha = getSha(project, helmfileContents);
  
        return project;
      })
    );
  }

  function updateHelmfileSha(content,project) {
    let re = new RegExp(String.raw`${project.helmfileTagKey}: "(.*?)"`, "g");
    return content.replace(re, `${project.helmfileTagKey}: "${shortSha(project.headSha)}"`);
  }

// HELMFILE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

async function main(closePRsFirst, titlePrefix, projects) {
  const prTemplate = await getContents(
    TARGET_REPO,
    PR_TEMPLATE_PATH
  );
  const issueContent = Base64.decode(prTemplate.content);

  await hydrateWithSHAs(projects);

  const reducer = (previous, project) => ({ ...previous, [project.helmfileOverride]: (previous[project.helmfileOverride] || []).concat(project) })
  const projectsForFiles = projects.reduce(reducer, {})

  var changesToHelmfile = Object.entries(projectsForFiles).map(async ([helmfileOverride, projectsForFile]) => {

    const releaseContent = await getContents(
      TARGET_REPO,
      helmfileOverride
    );


    var fileContents = Base64.decode(releaseContent.content)
    projectsForFile.forEach((project) => {
      fileContents = updateHelmfileSha(fileContents, project)
    })

    const newReleaseContentBlob = Base64.encode(fileContents);
    const fileHasChanged = newReleaseContentBlob.trim() != releaseContent.content.trim()

    return { helmfileOverride, newReleaseContentBlob, releaseContent, fileHasChanged }
  })

  changesToHelmfile = await Promise.all(changesToHelmfile)

  const helmFilesHaveChanged = changesToHelmfile.some(({ fileHasChanged }) => fileHasChanged)
  const extraFileChanges = [];

  if (TARGET_REPO === "notification-terraform") {
    const terraformVersionChange = await getTerraformVersionChange();
    if (terraformVersionChange && terraformVersionChange.fileHasChanged) {
      extraFileChanges.push(terraformVersionChange);
    }
  }

  const extraFilesHaveChanged = extraFileChanges.some(({ fileHasChanged }) => fileHasChanged)

  if (helmFilesHaveChanged || extraFilesHaveChanged) {
    if (closePRsFirst) {
      await closePRs(titlePrefix);
    }
    await createPR(
      titlePrefix,
      projects,
      issueContent,
      changesToHelmfile,
      extraFileChanges
    );
  } else {
    console.log("No changes detected, skipping PR creation.");
  }
}


// Main execute ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

main(true, TITLE_PREFIX, PROJECTS);

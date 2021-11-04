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
  shortSha,
  getSha,
  getLatestImageUrl
};
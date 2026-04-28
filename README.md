# PR-bot

Automatically creates production deployment PRs against a configurable target
repository.  Out of the box it is set up for
[notification-manifests](https://github.com/cds-snc/notification-manifests),
but every aspect of that configuration can be overridden via inputs so the bot
can be reused for any repository.

## Inputs / environment variables

| Input (action `with:`) | Environment variable | Default | Description |
|---|---|---|---|
| `token` | `TOKEN` | *(required)* | GitHub token with `repo` and `workflow` scopes |
| `target_repo` | `TARGET_REPO` | `notification-manifests` | cds-snc repository to open the release PR against |
| `title_prefix` | `TITLE_PREFIX` | `[AUTO-PR]` | Prefix on auto-generated PR titles (also used to close stale PRs) |
| `pr_template_path` | `PR_TEMPLATE_PATH` | `.github/PULL_REQUEST_TEMPLATE.md` | Path to the PR template file inside the target repository |
| `projects` | `PROJECTS` | *(see index.js)* | JSON array of helmfile project configurations |
| `projects_lambdas` | `PROJECTS_LAMBDAS` | *(see index.js)* | JSON array of Lambda image project configurations |

When the bot is invoked as a GitHub Action the values are read from the `with:`
block.  When run locally they can be set as plain environment variables.

## Usage as a GitHub Action

```yaml
- uses: cds-snc/notification-pr-bot@main
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    target_repo: my-release-repo
    title_prefix: '[AUTO-RELEASE]'
    pr_template_path: '.github/PULL_REQUEST_TEMPLATE.md'
    projects: |
      [
        {
          "repoName": "my-app",
          "helmfileOverride": "helmfile/overrides/production.env",
          "helmfileTagKey": "APP_DOCKER_TAG",
          "ecrUrl": "public.ecr.aws/cds-snc",
          "ecrName": "my-app"
        }
      ]
    projects_lambdas: '[]'
```

## Development

Edit the [index.js](index.js) file as needed and then run the build command to
produce a single artifact in the `dist` folder.

```shell
npm run build
```

## Local environment

[Create a GitHub API token](https://github.com/settings/tokens) with `repo`
and `workflow` scopes, then pass it along with any overrides you need:

```shell
TOKEN="${YOUR_TOKEN}" \
TARGET_REPO="my-repo" \
PROJECTS='[{"repoName":"my-app","helmfileOverride":"helmfile/overrides/production.env","helmfileTagKey":"APP_DOCKER_TAG","ecrUrl":"public.ecr.aws/my-org","ecrName":"my-app"}]' \
PROJECTS_LAMBDAS='[]' \
node index.js
```

Or export the variables for repeated runs:

```shell
export TOKEN="${YOUR_TOKEN}"
export TARGET_REPO="my-repo"
node index.js
```

Note: in production the auth token is fetched via
https://github.com/organizations/cds-snc/settings/installations/17812835
(CDS GitHub admin access required).
 
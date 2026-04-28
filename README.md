# PR-bot

Automatically creates production deployment PRs against a configurable target
repository.  Out of the box it is set up for
[notification-manifests](https://github.com/cds-snc/notification-manifests),
and it includes built-in defaults for
[notification-terraform](https://github.com/cds-snc/notification-terraform).

Set `target_repo` and the bot applies the matching defaults for title prefix,
template path, and image update config.

## Inputs / environment variables

| Input (action `with:`) | Environment variable | Default | Description |
|---|---|---|---|
| `token` | `TOKEN` | *(required)* | GitHub token with `repo` and `workflow` scopes |
| `target_repo` | `TARGET_REPO` | `notification-manifests` | Target repo. Currently tuned for `notification-manifests` and `notification-terraform` |
| `title_prefix` | `TITLE_PREFIX` | target-specific | Optional override for PR title prefix |
| `pr_template_path` | `PR_TEMPLATE_PATH` | target-specific | Optional override for PR template path |
| `projects` | `PROJECTS` | target-specific | Optional JSON override for project image updates |
| `projects_lambdas` | `PROJECTS_LAMBDAS` | target-specific | Optional JSON override for Lambda image updates |

When the bot is invoked as a GitHub Action the values are read from the `with:`
block.  When run locally they can be set as plain environment variables.

## Usage as a GitHub Action

```yaml
- uses: cds-snc/notification-pr-bot@main
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    target_repo: notification-manifests
```

Or for terraform:

```yaml
- uses: cds-snc/notification-pr-bot@main
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    target_repo: notification-terraform
```

Advanced use: pass `projects` / `projects_lambdas` JSON only if you need to
override the built-in repo defaults.

## Development

Edit the [index.js](index.js) file as needed and then run the build command to
produce a single artifact in the `dist` folder.

Target-specific defaults for `notification-manifests` and
`notification-terraform` are defined in [repo-defaults.js](repo-defaults.js).

```shell
npm run build
```

## Local environment

[Create a GitHub API token](https://github.com/settings/tokens) with `repo`
and `workflow` scopes, then pass it along with any overrides you need:

```shell
TOKEN="${YOUR_TOKEN}" \
TARGET_REPO="notification-manifests" \
node index.js
```

Or export the variables for repeated runs:

```shell
export TOKEN="${YOUR_TOKEN}"
export TARGET_REPO="notification-terraform"
node index.js
```

Note: in production the auth token is fetched via
https://github.com/organizations/cds-snc/settings/installations/17812835
(CDS GitHub admin access required).
 
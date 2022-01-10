# PR-bot

Automatically creates the production deployment PRs for Notify on
[notification-manifests](https://github.com/cds-snc/notification-manifests).

## Development

Edit the [index.js](index.js) file as needed and then run the build command to
produce a single artifact in the `dist` folder.

```shell
npm run build
```

## Local Environment

To run the PR-bot locally,
[first create an API token in GitHub](https://github.com/settings/tokens) with
a scope defined on both repository access and workflow access. The PR bot script only need these.

Once the token is created, you will need to provide it to the script's environment
when executing it:

```shell
TOKEN="${YOUR_TOKEN}" node index.js 
```

Alternatively, you can also export the variable if you have to execute the script multiple times
in your current shell session:

```shell
export TOKEN="${YOUR_TOKEN}"
node index.js
```

Note that in production we fetch the auth token https://github.com/organizations/cds-snc/settings/installations/17812835 (CDS GitHub admin access required) 
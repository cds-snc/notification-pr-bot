# Use the official TypeScript Node.js image as a base
FROM mcr.microsoft.com/devcontainers/typescript-node:5.2.5-24-bookworm@sha256:973037be1c64ff7f0b9409ae136fd7fe83718b2af30e8872ba11ac69a422eb9b

# Install additional features
RUN apt-get update && apt-get install -y \
    awscli \
    curl \
    exa \
    jq \
    fzf \
    locate \
    manpages \
    ripgrep \
    shellcheck \
    && rm -rf /var/lib/apt/lists/*

# -- Install CA certificates and update them to disable emSign ECC Root CA - G3 and Comodo AAA Services root --
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    sed -i \
      -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' \
      -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' \
      /etc/ca-certificates.conf && \
    update-ca-certificates --fresh

ENV SHELL /bin/zsh

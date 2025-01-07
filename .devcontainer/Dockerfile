# Use the official TypeScript Node.js image as a base
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

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

ENV SHELL /bin/zsh

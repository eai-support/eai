#!/usr/bin/env bash

set -u

WORKSPACE_PATH=""
TOOLS_CSV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace-path)
      WORKSPACE_PATH="${2:-}"
      shift 2
      ;;
    --tools)
      TOOLS_CSV="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      shift
      ;;
  esac
done

if [[ -z "$WORKSPACE_PATH" ]]; then
  WORKSPACE_PATH="$(pwd)"
fi

if [[ -z "$TOOLS_CSV" ]]; then
  echo "No tools selected. Nothing to install."
  exit 0
fi

IFS=',' read -r -a TOOLS <<< "$TOOLS_CSV"

REPO_ROOT="$WORKSPACE_PATH"

HAS_FAILURE=0

log_info() {
  printf '[gofer] %s\n' "$1"
}

log_warn() {
  printf '[gofer] WARNING: %s\n' "$1"
}

log_error() {
  printf '[gofer] ERROR: %s\n' "$1" >&2
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

run_command() {
  local description="$1"
  shift

  log_info "$description"
  if "$@"; then
    return 0
  fi

  HAS_FAILURE=1
  log_error "Failed: $description"
  return 1
}

detect_js_package_manager() {
  if [[ -f "$REPO_ROOT/bun.lockb" ]]; then
    echo "bun"
    return
  fi

  if [[ -f "$REPO_ROOT/pnpm-lock.yaml" ]]; then
    echo "pnpm"
    return
  fi

  if [[ -f "$REPO_ROOT/yarn.lock" ]]; then
    echo "yarn"
    return
  fi

  if [[ -f "$REPO_ROOT/package.json" ]]; then
    echo "npm"
    return
  fi

  echo ""
}

install_repo_package() {
  local package_manager="$1"
  local package_name="$2"

  case "$package_manager" in
    npm)
      run_command "Installing $package_name with npm" npm install --save-dev "$package_name"
      ;;
    pnpm)
      run_command "Installing $package_name with pnpm" pnpm add --save-dev "$package_name"
      ;;
    yarn)
      run_command "Installing $package_name with yarn" yarn add --dev "$package_name"
      ;;
    bun)
      run_command "Installing $package_name with bun" bun add --dev "$package_name"
      ;;
    *)
      HAS_FAILURE=1
      log_warn "No supported JS package manager detected for $package_name"
      ;;
  esac
}

install_playwright_browsers() {
  if [[ ! -f "$REPO_ROOT/package.json" ]]; then
    log_warn "Skipping Playwright browser install because package.json was not found"
    return
  fi

  (
    cd "$REPO_ROOT" || exit 1
    run_command "Installing Playwright browsers" npx playwright install
  )
}

install_with_npm_global() {
  local package_name="$1"

  if ! has_command npm; then
    HAS_FAILURE=1
    log_warn "npm is required to install $package_name globally"
    return
  fi

  run_command "Installing $package_name globally with npm" npm install --global "$package_name"
}

install_gh_cli() {
  if has_command gh; then
    log_info "GitHub CLI is already installed"
    return
  fi

  if [[ "$OSTYPE" == darwin* ]]; then
    if has_command brew; then
      run_command "Installing GitHub CLI with Homebrew" brew install gh
      return
    fi
  fi

  if has_command apt-get; then
    run_command "Updating apt package index for GitHub CLI" sudo apt-get update
    run_command "Installing GitHub CLI with apt-get" sudo apt-get install --yes gh
    return
  fi

  if has_command dnf; then
    run_command "Installing GitHub CLI with dnf" sudo dnf install --assumeyes gh
    return
  fi

  if has_command yum; then
    run_command "Installing GitHub CLI with yum" sudo yum install --assumeyes gh
    return
  fi

  if has_command zypper; then
    run_command "Installing GitHub CLI with zypper" sudo zypper --non-interactive install gh
    return
  fi

  HAS_FAILURE=1
  log_warn "No supported package manager found to install GitHub CLI"
}

install_azure_cli() {
  if has_command az; then
    log_info "Azure CLI is already installed"
    return
  fi

  if [[ "$OSTYPE" == darwin* ]]; then
    if has_command brew; then
      run_command "Installing Azure CLI with Homebrew" brew install azure-cli
      return
    fi
  fi

  if has_command apt-get; then
    run_command "Installing Azure CLI using Microsoft Debian installer" bash -c "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash"
    return
  fi

  if has_command dnf; then
    run_command "Registering Microsoft package feed for Azure CLI" sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
    run_command "Installing Microsoft package feed for Azure CLI" bash -c 'sudo dnf install --assumeyes "https://packages.microsoft.com/config/rhel/$(rpm -E %rhel)/packages-microsoft-prod.rpm"'
    run_command "Installing Azure CLI with dnf" sudo dnf install --assumeyes azure-cli
    return
  fi

  if has_command yum; then
    run_command "Registering Microsoft package feed for Azure CLI" sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
    run_command "Installing Microsoft package feed for Azure CLI" bash -c 'sudo yum install --assumeyes "https://packages.microsoft.com/config/rhel/$(rpm -E %rhel)/packages-microsoft-prod.rpm"'
    run_command "Installing Azure CLI with yum" sudo yum install --assumeyes azure-cli
    return
  fi

  HAS_FAILURE=1
  log_warn "No supported package manager found to install Azure CLI"
}

log_info "Workspace: $REPO_ROOT"
log_info "Selected tools: $TOOLS_CSV"

PACKAGE_MANAGER="$(detect_js_package_manager)"

for tool in "${TOOLS[@]}"; do
  case "$tool" in
    stryker)
      install_repo_package "$PACKAGE_MANAGER" "@stryker-mutator/core"
      ;;
    playwright)
      install_repo_package "$PACKAGE_MANAGER" "@playwright/test"
      install_playwright_browsers
      ;;
    claude)
      install_with_npm_global "@anthropic-ai/claude-code"
      ;;
    codex)
      install_with_npm_global "@openai/codex-cli"
      ;;
    gemini)
      install_with_npm_global "@google/gemini-cli"
      ;;
    gh)
      install_gh_cli
      ;;
    az)
      install_azure_cli
      ;;
    "")
      ;;
    *)
      HAS_FAILURE=1
      log_warn "Unknown tool id: $tool"
      ;;
  esac
done

log_info "Suggested next steps:"
log_info "  claude login"
log_info "  codex login"
log_info "  gemini auth login"
log_info "  gh auth login"
log_info "  az login"

if [[ "$HAS_FAILURE" -ne 0 ]]; then
  log_warn "Optional tool installation completed with warnings or failures"
  exit 1
fi

log_info "Optional tool installation complete"

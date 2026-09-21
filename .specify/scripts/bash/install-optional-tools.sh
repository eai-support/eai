#!/usr/bin/env bash

set -uo pipefail

WORKSPACE_PATH=""
TOOLS_CSV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace-path)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "Missing value for --workspace-path." >&2
        exit 64
      fi
      WORKSPACE_PATH="$2"
      shift 2
      ;;
    --tools)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "Missing value for --tools." >&2
        exit 64
      fi
      TOOLS_CSV="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument. Expected --workspace-path or --tools." >&2
      exit 64
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
TEMP_INSTALLERS=()
ACTIVE_INSTALLER_PID=""
INSTALLER_TIMEOUT_SECONDS=900

terminate_process_tree() {
  local target_pid="$1"
  local signal_name="$2"
  local child_pid

  [[ "$target_pid" =~ ^[1-9][0-9]*$ ]] || return 0
  if [[ -x /usr/bin/pgrep ]]; then
    while IFS= read -r child_pid; do
      if [[ "$child_pid" =~ ^[1-9][0-9]*$ ]]; then
        terminate_process_tree "$child_pid" "$signal_name"
      fi
    done < <(/usr/bin/pgrep -P "$target_pid" 2>/dev/null || true)
  fi
  kill "-$signal_name" "$target_pid" 2>/dev/null || true
}

cleanup_temp_installers() {
  local installer_path
  if [[ -n "$ACTIVE_INSTALLER_PID" ]]; then
    terminate_process_tree "$ACTIVE_INSTALLER_PID" TERM
    terminate_process_tree "$ACTIVE_INSTALLER_PID" KILL
  fi
  for installer_path in "${TEMP_INSTALLERS[@]-}"; do
    if [[ -n "$installer_path" ]]; then
      rm -f -- "$installer_path"
    fi
  done
}

trap cleanup_temp_installers EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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

validate_installed_cli() {
  local tool_name="$1"
  local command_path="$2"
  if [[ ! -f "$command_path" || ! -x "$command_path" ]]; then
    HAS_FAILURE=1
    log_error "$tool_name installation did not produce its expected executable"
    return 1
  fi
  log_info "$tool_name installer produced its provider-defined executable"
}

install_pinned_copilot_cli() {
  local package_spec='@github/copilot@1.0.83'
  local expected_integrity='sha512-M8uZI0V0dahYV1KZij3nGDxaXEGG7I7YUZzQPI7NEZkL/83Nl/tNTbPdxKtdWZbOmWoXsPKXty/eEYoj6RHDhA=='
  local registry='https://registry.npmjs.org/'
  local npm_path
  npm_path="$(type -P npm 2>/dev/null || true)"
  if [[ -z "$npm_path" || ! -f "$npm_path" || ! -x "$npm_path" ]]; then
    HAS_FAILURE=1
    log_warn "npm is required to install $package_spec globally"
    return 1
  fi

  log_info "Verifying the pinned GitHub Copilot CLI package"
  local actual_integrity
  if ! actual_integrity="$("$npm_path" view "$package_spec" dist.integrity --json --registry="$registry" 2>/dev/null)"; then
    HAS_FAILURE=1
    log_error "Could not resolve the pinned GitHub Copilot CLI package"
    return 1
  fi
  actual_integrity="${actual_integrity#\"}"
  actual_integrity="${actual_integrity%\"}"
  if [[ "$actual_integrity" != "$expected_integrity" ]]; then
    HAS_FAILURE=1
    log_error "Refusing GitHub Copilot CLI because its npm integrity changed"
    return 1
  fi

  log_info "Installing the pinned GitHub Copilot CLI"
  if ! "$npm_path" install --global "$package_spec" --registry="$registry" \
      --ignore-scripts --no-audit --no-fund >/dev/null 2>&1; then
    HAS_FAILURE=1
    log_error "Failed: Installing the pinned GitHub Copilot CLI"
    return 1
  fi
  if ! "$npm_path" list --global --depth=0 "$package_spec" >/dev/null 2>&1; then
    HAS_FAILURE=1
    log_error "The installed GitHub Copilot CLI package did not match the pinned version"
    return 1
  fi

  local npm_prefix
  npm_prefix="$("$npm_path" prefix --global 2>/dev/null || true)"
  case "$npm_prefix" in
    /*) ;;
    *)
      HAS_FAILURE=1
      log_error "Could not resolve an absolute npm prefix for GitHub Copilot CLI"
      return 1
      ;;
  esac
  validate_installed_cli "GitHub Copilot CLI" "$npm_prefix/bin/copilot"
}

compute_sha256() {
  local target_path="$1"

  if [[ -x /usr/bin/shasum ]]; then
    /usr/bin/shasum -a 256 "$target_path" | /usr/bin/awk '{print $1}'
    return
  fi

  if [[ -x /usr/bin/sha256sum ]]; then
    /usr/bin/sha256sum "$target_path" | /usr/bin/awk '{print $1}'
    return
  fi

  if [[ -x /usr/bin/openssl ]]; then
    /usr/bin/openssl dgst -sha256 "$target_path" | /usr/bin/awk '{print $NF}'
    return
  fi

  return 1
}

run_sanitized_installer() {
  local shell_name="$1"
  local installer_fd_path="$2"
  local shell_path
  case "$shell_name" in
    bash) shell_path=/bin/bash ;;
    sh) shell_path=/bin/sh ;;
    *)
      log_error "Refusing an unsupported installer interpreter"
      return 1
      ;;
  esac
  [[ -x "$shell_path" ]] || {
    log_error "The required installer interpreter is unavailable"
    return 1
  }

  /usr/bin/env -i \
    HOME="${HOME:-}" \
    USER="${USER:-}" \
    LOGNAME="${LOGNAME:-}" \
    SHELL="${SHELL:-/bin/sh}" \
    PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-C}" \
    LC_ALL="${LC_ALL:-}" \
    XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-}" \
    XDG_DATA_HOME="${XDG_DATA_HOME:-}" \
    XDG_CACHE_HOME="${XDG_CACHE_HOME:-}" \
    CODEX_NON_INTERACTIVE=1 \
    "$shell_path" "$installer_fd_path" &
  ACTIVE_INSTALLER_PID=$!

  local deadline=$((SECONDS + INSTALLER_TIMEOUT_SECONDS))
  while kill -0 "$ACTIVE_INSTALLER_PID" 2>/dev/null; do
    if (( SECONDS >= deadline )); then
      terminate_process_tree "$ACTIVE_INSTALLER_PID" TERM
      /bin/sleep 2
      terminate_process_tree "$ACTIVE_INSTALLER_PID" KILL
      wait "$ACTIVE_INSTALLER_PID" 2>/dev/null || true
      ACTIVE_INSTALLER_PID=""
      log_error "The provider installer exceeded its bounded execution time"
      return 124
    fi
    /bin/sleep 1
  done

  local installer_status=0
  wait "$ACTIVE_INSTALLER_PID" || installer_status=$?
  ACTIVE_INSTALLER_PID=""
  return "$installer_status"
}

install_from_official_script() {
  local tool_name="$1"
  local script_url="$2"
  local shell_name="$3"
  local expected_sha256="$4"
  local allowed_final_origin="$5"

  if [[ ! -x /usr/bin/curl ]]; then
    HAS_FAILURE=1
    log_warn "curl is required to install $tool_name from its official provider"
    return 1
  fi

  local installer_path
  installer_path="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/gofer-installer.XXXXXX" 2>/dev/null)" || {
    HAS_FAILURE=1
    log_error "Could not create a temporary installer for $tool_name"
    return 1
  }
  TEMP_INSTALLERS+=("$installer_path")

  log_info "Installing or updating $tool_name from $script_url"
  local effective_url
  if ! effective_url="$(/usr/bin/curl --fail --silent --show-error --location \
      --proto '=https' --proto-redir '=https' --tlsv1.2 \
      --max-redirs 5 --connect-timeout 15 --max-time 120 --max-filesize 1048576 \
      --output "$installer_path" --write-out '%{url_effective}' "$script_url" 2>/dev/null)"; then
    HAS_FAILURE=1
    log_error "Failed to download the official $tool_name installer"
    rm -f -- "$installer_path"
    return 1
  fi

  case "$effective_url" in
    "$allowed_final_origin"|"$allowed_final_origin"/*)
      ;;
    *)
      HAS_FAILURE=1
      log_error "Refusing $tool_name installer from an unexpected redirect origin"
      rm -f -- "$installer_path"
      return 1
      ;;
  esac

  if [[ ! -s "$installer_path" ]]; then
    HAS_FAILURE=1
    log_error "Refusing an empty $tool_name installer"
    rm -f -- "$installer_path"
    return 1
  fi

  # Open two independent descriptors, then unlink the pathname. The hash and
  # interpreter now consume the same unreachable inode without a path-based
  # replacement window between verification and execution.
  if ! exec 8<"$installer_path" || ! exec 9<"$installer_path"; then
    HAS_FAILURE=1
    log_error "Could not secure the downloaded $tool_name installer"
    rm -f -- "$installer_path"
    exec 8<&- 2>/dev/null || true
    exec 9<&- 2>/dev/null || true
    return 1
  fi
  rm -f -- "$installer_path"

  local actual_sha256
  if ! actual_sha256="$(compute_sha256 /dev/fd/8 2>/dev/null)"; then
    HAS_FAILURE=1
    log_error "No supported SHA-256 tool is available to verify $tool_name"
    exec 8<&-
    exec 9<&-
    return 1
  fi
  exec 8<&-

  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    HAS_FAILURE=1
    log_error "Refusing $tool_name installer because its SHA-256 digest changed"
    exec 9<&-
    return 1
  fi

  # Provider output is intentionally not relayed: verified installers can still
  # print local paths or inherited account data. Emit only bounded Gofer-owned
  # status messages around the isolated child process.
  if ! run_sanitized_installer "$shell_name" /dev/fd/9 >/dev/null 2>&1; then
    HAS_FAILURE=1
    log_error "Failed: Installing or updating $tool_name"
    exec 9<&-
    return 1
  fi
  exec 9<&-
  return 0
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
    if ! has_command apt-cache || ! apt-cache show azure-cli >/dev/null 2>&1; then
      HAS_FAILURE=1
      log_warn "Azure CLI is unavailable from the configured apt repositories"
      log_warn "Configure Microsoft's signed Azure CLI apt repository, then rerun Gofer"
      return 1
    fi
    run_command "Updating apt package index for Azure CLI" sudo apt-get update
    run_command "Installing Azure CLI with apt-get" sudo apt-get install --yes azure-cli
    return
  fi

  if has_command dnf; then
    local rhel_release
    rhel_release="$(rpm -E %rhel)"
    if [[ ! "$rhel_release" =~ ^[0-9]+$ ]]; then
      HAS_FAILURE=1
      log_warn "Could not determine a safe RHEL release for the Azure CLI feed"
      return
    fi
    run_command "Registering Microsoft package feed for Azure CLI" sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
    run_command "Installing Microsoft package feed for Azure CLI" sudo dnf install --assumeyes "https://packages.microsoft.com/config/rhel/$rhel_release/packages-microsoft-prod.rpm"
    run_command "Installing Azure CLI with dnf" sudo dnf install --assumeyes azure-cli
    return
  fi

  if has_command yum; then
    local rhel_release
    rhel_release="$(rpm -E %rhel)"
    if [[ ! "$rhel_release" =~ ^[0-9]+$ ]]; then
      HAS_FAILURE=1
      log_warn "Could not determine a safe RHEL release for the Azure CLI feed"
      return
    fi
    run_command "Registering Microsoft package feed for Azure CLI" sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
    run_command "Installing Microsoft package feed for Azure CLI" sudo yum install --assumeyes "https://packages.microsoft.com/config/rhel/$rhel_release/packages-microsoft-prod.rpm"
    run_command "Installing Azure CLI with yum" sudo yum install --assumeyes azure-cli
    return
  fi

  HAS_FAILURE=1
  log_warn "No supported package manager found to install Azure CLI"
}

NORMALIZED_TOOLS=()
NORMALIZED_TOOLS_CSV=""
for raw_tool in "${TOOLS[@]}"; do
  normalized_tool="${raw_tool#"${raw_tool%%[![:space:]]*}"}"
  normalized_tool="${normalized_tool%"${normalized_tool##*[![:space:]]}"}"
  case "$normalized_tool" in
    agy|gemini) normalized_tool="antigravity" ;;
  esac
  case "$normalized_tool" in
    "") continue ;;
    *[!a-z0-9-]*) normalized_tool="invalid-tool-id" ;;
  esac
  case ",$NORMALIZED_TOOLS_CSV," in
    *,"$normalized_tool",*) ;;
    *)
      NORMALIZED_TOOLS+=("$normalized_tool")
      NORMALIZED_TOOLS_CSV="${NORMALIZED_TOOLS_CSV:+$NORMALIZED_TOOLS_CSV,}$normalized_tool"
      ;;
  esac
done
TOOLS=("${NORMALIZED_TOOLS[@]}")
TOOLS_CSV="$NORMALIZED_TOOLS_CSV"

log_info "Workspace selected"
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
      if install_from_official_script "Claude Code" "https://claude.ai/install.sh" bash \
        "3a68d3406cf674e17bed1733a4dcf37805e2e47d87417700007d7e1aa766a944" \
        "https://downloads.claude.ai"; then
        validate_installed_cli "Claude Code" "${HOME:?HOME is required}/.local/bin/claude"
      fi
      ;;
    codex)
      if install_from_official_script "Codex CLI" "https://chatgpt.com/codex/install.sh" sh \
        "ba92dd27e5c06f0d3bbc58bfa4b9cfb6599cd2742fbb1f92a2765e6c07dedb5a" \
        "https://releases.openai.com"; then
        validate_installed_cli "Codex CLI" "${HOME:?HOME is required}/.local/bin/codex"
      fi
      ;;
    copilot)
      install_pinned_copilot_cli
      ;;
    antigravity)
      if install_from_official_script "Antigravity CLI (agy)" "https://antigravity.google/cli/install.sh" bash \
        "ee1ea43ce4e9e56356c4ab6dad907ef357ae4bdfcaadb682735909fb57c9c640" \
        "https://antigravity.google"; then
        validate_installed_cli "Antigravity CLI" "${HOME:?HOME is required}/.local/bin/agy"
      fi
      ;;
    grok)
      if install_from_official_script "Grok Build" "https://x.ai/cli/install.sh" bash \
        "7fd6fdc75d9418b2e58356726fcbf1ae849416f773925da07d0ccc7a60d3e791" \
        "https://x.ai"; then
        validate_installed_cli "Grok Build" "${HOME:?HOME is required}/.grok/bin/grok"
      fi
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
log_info "  claude auth login"
log_info "  codex login"
log_info "  copilot login"
log_info "  agy"
log_info "  grok"
log_info "  gh auth login"
log_info "  az login"

if [[ "$HAS_FAILURE" -ne 0 ]]; then
  log_warn "Optional tool installation completed with warnings or failures"
  exit 1
fi

log_info "Optional tool installation complete"

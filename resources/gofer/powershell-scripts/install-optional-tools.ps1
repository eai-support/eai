param(
  [string]$WorkspacePath = (Get-Location).Path,
  [string]$Tools = ''
)

$ErrorActionPreference = 'Stop'
$HasFailure = $false

function Write-Info {
  param([string]$Message)
  Write-Host "[gofer] $Message"
}

function Write-Warn {
  param([string]$Message)
  Write-Warning "[gofer] $Message"
}

function Invoke-Step {
  param(
    [string]$Description,
    [scriptblock]$ScriptBlock
  )

  Write-Info $Description
  try {
    & $ScriptBlock
  } catch {
    $script:HasFailure = $true
    Write-Warn "Failed: $Description"
    Write-Warn $_.Exception.Message
  }
}

function Test-CommandExists {
  param([string]$CommandName)
  return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Get-JsPackageManager {
  if (Test-Path (Join-Path $WorkspacePath 'bun.lockb')) {
    return 'bun'
  }

  if (Test-Path (Join-Path $WorkspacePath 'pnpm-lock.yaml')) {
    return 'pnpm'
  }

  if (Test-Path (Join-Path $WorkspacePath 'yarn.lock')) {
    return 'yarn'
  }

  if (Test-Path (Join-Path $WorkspacePath 'package.json')) {
    return 'npm'
  }

  return ''
}

function Install-RepoPackage {
  param(
    [string]$PackageManager,
    [string]$PackageName
  )

  switch ($PackageManager) {
    'npm' {
      Invoke-Step "Installing $PackageName with npm" { npm install --save-dev $PackageName }
    }
    'pnpm' {
      Invoke-Step "Installing $PackageName with pnpm" { pnpm add --save-dev $PackageName }
    }
    'yarn' {
      Invoke-Step "Installing $PackageName with yarn" { yarn add --dev $PackageName }
    }
    'bun' {
      Invoke-Step "Installing $PackageName with bun" { bun add --dev $PackageName }
    }
    default {
      $script:HasFailure = $true
      Write-Warn "No supported JS package manager detected for $PackageName"
    }
  }
}

function Install-PlaywrightBrowsers {
  if (-not (Test-Path (Join-Path $WorkspacePath 'package.json'))) {
    Write-Warn 'Skipping Playwright browser install because package.json was not found'
    return
  }

  Push-Location $WorkspacePath
  try {
    Invoke-Step 'Installing Playwright browsers' { npx playwright install }
  } finally {
    Pop-Location
  }
}

function Install-NpmGlobalPackage {
  param([string]$PackageName)

  if (-not (Test-CommandExists 'npm')) {
    $script:HasFailure = $true
    Write-Warn "npm is required to install $PackageName globally"
    return
  }

  Invoke-Step "Installing $PackageName globally with npm" { npm install --global $PackageName }
}

function Install-GitHubCli {
  if (Test-CommandExists 'gh') {
    Write-Info 'GitHub CLI is already installed'
    return
  }

  if (Test-CommandExists 'winget') {
    Invoke-Step 'Installing GitHub CLI with winget' {
      winget install --id GitHub.cli --exact --source winget
    }
    return
  }

  if (Test-CommandExists 'choco') {
    Invoke-Step 'Installing GitHub CLI with Chocolatey' { choco install gh --yes }
    return
  }

  $script:HasFailure = $true
  Write-Warn 'No supported package manager found to install GitHub CLI'
}

function Install-AzureCli {
  if (Test-CommandExists 'az') {
    Write-Info 'Azure CLI is already installed'
    return
  }

  if (Test-CommandExists 'winget') {
    Invoke-Step 'Installing Azure CLI with winget' {
      winget install --id Microsoft.AzureCLI --exact --source winget
    }
    return
  }

  if (Test-CommandExists 'choco') {
    Invoke-Step 'Installing Azure CLI with Chocolatey' { choco install azure-cli --yes }
    return
  }

  $script:HasFailure = $true
  Write-Warn 'No supported package manager found to install Azure CLI'
}

if ([string]::IsNullOrWhiteSpace($Tools)) {
  Write-Info 'No tools selected. Nothing to install.'
  exit 0
}

$toolList = $Tools.Split(',', [System.StringSplitOptions]::RemoveEmptyEntries)
$packageManager = Get-JsPackageManager

Write-Info "Workspace: $WorkspacePath"
Write-Info "Selected tools: $Tools"

foreach ($tool in $toolList) {
  switch ($tool.Trim()) {
    'stryker' {
      Install-RepoPackage -PackageManager $packageManager -PackageName '@stryker-mutator/core'
    }
    'playwright' {
      Install-RepoPackage -PackageManager $packageManager -PackageName '@playwright/test'
      Install-PlaywrightBrowsers
    }
    'claude' {
      Install-NpmGlobalPackage -PackageName '@anthropic-ai/claude-code'
    }
    'codex' {
      Install-NpmGlobalPackage -PackageName '@openai/codex-cli'
    }
    'copilot' {
      Install-NpmGlobalPackage -PackageName '@github/copilot'
    }
    'gemini' {
      Install-NpmGlobalPackage -PackageName '@google/gemini-cli'
    }
    'gh' {
      Install-GitHubCli
    }
    'az' {
      Install-AzureCli
    }
    default {
      $script:HasFailure = $true
      Write-Warn "Unknown tool id: $tool"
    }
  }
}

Write-Info 'Suggested next steps:'
Write-Info '  claude login'
Write-Info '  codex login'
Write-Info '  copilot login'
Write-Info '  gemini auth login'
Write-Info '  gh auth login'
Write-Info '  az login'

if ($HasFailure) {
  Write-Warn 'Optional tool installation completed with warnings or failures'
  exit 1
}

Write-Info 'Optional tool installation complete'

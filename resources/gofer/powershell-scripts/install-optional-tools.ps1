param(
  [string]$WorkspacePath = (Get-Location).Path,
  [string]$Tools = ''
)

$ErrorActionPreference = 'Stop'
$HasFailure = $false
$LastStepSucceeded = $true

function Write-Info {
  param([string]$Message)
  Write-Host "[gofer] $Message"
}

function Write-Warn {
  param([string]$Message)
  Write-Warning "[gofer] $Message"
}

function ConvertTo-SafeDiagnostic {
  param([string]$Message)

  if ([string]::IsNullOrEmpty($Message)) {
    return 'No diagnostic details were provided.'
  }

  $safeMessage = $Message
  foreach ($localRoot in @(
    $WorkspacePath,
    $HOME,
    $env:USERPROFILE,
    [System.IO.Path]::GetTempPath()
  )) {
    if (-not [string]::IsNullOrWhiteSpace($localRoot)) {
      $safeMessage = [regex]::Replace(
        $safeMessage,
        [regex]::Escape($localRoot),
        '<local-path>',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
      )
    }
  }
  $safeMessage = $safeMessage `
    -replace '(?i)\b((?:api[-_ ]?key|token|secret|password|credential)\s*[:=]\s*)[^\s,;]+', '$1<redacted>' `
    -replace '(?i)(https?://)[^\s/@:]+:[^\s/@]+@', '$1<redacted>@' `
    -replace '(?i)\b[A-Z]:\\Users\\[^\\\s"'']+', '<home>' `
    -replace '/(?:Users|home)/[^/\s"'']+', '<home>' `
    -replace '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', ''
  if ($safeMessage.Length -gt 4096) {
    return $safeMessage.Substring(0, 4096) + '...<truncated>'
  }
  return $safeMessage
}

function Invoke-Step {
  param(
    [string]$Description,
    [scriptblock]$ScriptBlock
  )

  Write-Info $Description
  $script:LastStepSucceeded = $true
  try {
    & $ScriptBlock
  } catch {
    $script:LastStepSucceeded = $false
    $script:HasFailure = $true
    Write-Warn "Failed: $Description"
    Write-Warn (ConvertTo-SafeDiagnostic $_.Exception.Message)
  }
}

function Test-CommandExists {
  param([string]$CommandName)
  return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Stop-InstallerProcess {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process) { return }
  try {
    if (-not $Process.HasExited) {
      try {
        # Kill the complete process tree where the current runtime supports it.
        $Process.Kill($true)
      } catch {
        # Windows PowerShell 5.1 exposes only Kill() without the tree overload.
        # taskkill is the operating-system fallback for terminating descendants.
        $taskkillPath = if ($env:SystemRoot) {
          Join-Path $env:SystemRoot 'System32\taskkill.exe'
        } else {
          $null
        }
        if ($taskkillPath -and [System.IO.File]::Exists($taskkillPath)) {
          & $taskkillPath /PID $Process.Id /T /F *> $null
        } else {
          $Process.Kill()
        }
      }
      [void]$Process.WaitForExit(5000)
    }
  } catch {
    # Best-effort cleanup must not hide the original interruption or failure.
  }
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

function Test-InstalledCli {
  param(
    [string]$ToolName,
    [string[]]$ExpectedPaths
  )

  Invoke-Step "Validating the installed $ToolName executable path" {
    foreach ($candidatePath in $ExpectedPaths) {
      if ([string]::IsNullOrWhiteSpace($candidatePath) -or
          -not [System.IO.Path]::IsPathRooted($candidatePath)) {
        continue
      }
      $fullPath = [System.IO.Path]::GetFullPath($candidatePath)
      if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $item = Get-Item -LiteralPath $fullPath -Force
        if ($item.Length -gt 0) {
          Write-Info "$ToolName installer produced its provider-defined executable"
          return
        }
      }
    }
    throw "$ToolName installation did not produce its expected executable."
  }
}

function Install-PinnedCopilotCli {
  $packageSpec = '@github/copilot@1.0.83'
  $expectedIntegrity = 'sha512-M8uZI0V0dahYV1KZij3nGDxaXEGG7I7YUZzQPI7NEZkL/83Nl/tNTbPdxKtdWZbOmWoXsPKXty/eEYoj6RHDhA=='
  $registry = 'https://registry.npmjs.org/'

  $npmCommand = Get-Command -Name 'npm' -CommandType Application -All -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $npmCommand -or -not [System.IO.File]::Exists($npmCommand.Source)) {
    $script:HasFailure = $true
    Write-Warn "npm is required to install $packageSpec globally"
    return
  }

  $script:CopilotCommandPaths = @()
  Invoke-Step 'Verifying and installing the pinned GitHub Copilot CLI' {
    $integrityOutput = (& $npmCommand.Source view $packageSpec dist.integrity --json --registry=$registry 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
      throw 'Could not resolve the pinned GitHub Copilot CLI package.'
    }
    $actualIntegrity = $integrityOutput.Trim('"')
    if ($actualIntegrity -cne $expectedIntegrity) {
      throw 'Refusing GitHub Copilot CLI because its npm integrity changed.'
    }

    & $npmCommand.Source install --global $packageSpec --registry=$registry `
      --ignore-scripts --no-audit --no-fund *> $null
    if ($LASTEXITCODE -ne 0) {
      throw 'The pinned GitHub Copilot CLI installation failed.'
    }

    & $npmCommand.Source list --global --depth=0 $packageSpec *> $null
    if ($LASTEXITCODE -ne 0) {
      throw 'The installed GitHub Copilot CLI package did not match the pinned version.'
    }

    $npmPrefix = (& $npmCommand.Source prefix --global 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not [System.IO.Path]::IsPathRooted($npmPrefix)) {
      throw 'Could not resolve an absolute npm prefix for GitHub Copilot CLI.'
    }
    $script:CopilotCommandPaths = @(
      (Join-Path $npmPrefix 'copilot.cmd'),
      (Join-Path $npmPrefix 'copilot.exe'),
      (Join-Path $npmPrefix 'bin\copilot')
    )
  }
  if ($script:LastStepSucceeded) {
    Test-InstalledCli -ToolName 'GitHub Copilot CLI' -ExpectedPaths $script:CopilotCommandPaths
  }
}

function Get-OfficialInstallerPayload {
  param(
    [string]$ToolName,
    [string]$ScriptUrl,
    [string]$AllowedFinalOrigin
  )

  $initialUri = [System.Uri]$ScriptUrl
  $finalOriginUri = [System.Uri]$AllowedFinalOrigin
  if (-not $initialUri.IsAbsoluteUri -or $initialUri.Scheme -cne 'https' -or $initialUri.UserInfo) {
    throw "$ToolName installer URL is not an absolute HTTPS URL."
  }
  if (-not $finalOriginUri.IsAbsoluteUri -or $finalOriginUri.Scheme -cne 'https' -or
      $finalOriginUri.UserInfo -or $finalOriginUri.AbsolutePath -cne '/' -or
      $finalOriginUri.Query -or $finalOriginUri.Fragment) {
    throw "$ToolName final installer origin is invalid."
  }

  Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $httpClient = [System.Net.Http.HttpClient]::new($handler)
  $httpClient.Timeout = [TimeSpan]::FromMinutes(2)
  $httpClient.MaxResponseContentBufferSize = 1MB
  $allowedOrigins = @(
    $initialUri.GetLeftPart([System.UriPartial]::Authority),
    $finalOriginUri.GetLeftPart([System.UriPartial]::Authority)
  ) | Select-Object -Unique

  $currentUri = $initialUri
  $response = $null
  try {
    for ($redirectCount = 0; $redirectCount -le 5; $redirectCount += 1) {
      $currentOrigin = $currentUri.GetLeftPart([System.UriPartial]::Authority)
      if ($currentUri.Scheme -cne 'https' -or $currentUri.UserInfo -or
          $allowedOrigins -cnotcontains $currentOrigin) {
        throw "$ToolName installer redirected to an unapproved origin."
      }

      $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Get,
        $currentUri
      )
      try {
        $response = $httpClient.SendAsync(
          $request,
          [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
        ).GetAwaiter().GetResult()
      } finally {
        $request.Dispose()
      }

      $statusCode = [int]$response.StatusCode
      if ($statusCode -in @(301, 302, 303, 307, 308)) {
        $redirectLocation = $response.Headers.Location
        if ($null -eq $redirectLocation) {
          throw "$ToolName installer redirect omitted its destination."
        }
        $nextUri = if ($redirectLocation.IsAbsoluteUri) {
          $redirectLocation
        } else {
          [System.Uri]::new($currentUri, $redirectLocation)
        }
        $response.Dispose()
        $response = $null
        $currentUri = $nextUri
        continue
      }

      [void]$response.EnsureSuccessStatusCode()
      if ($currentOrigin -cne $finalOriginUri.GetLeftPart([System.UriPartial]::Authority)) {
        throw "$ToolName installer did not finish at its approved provider origin."
      }
      if ($response.Content.Headers.ContentLength.HasValue -and
          $response.Content.Headers.ContentLength.Value -gt 1MB) {
        throw "$ToolName installer exceeded the allowed download size."
      }
      $contentStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
      $buffer = New-Object byte[] 8192
      $memory = [System.IO.MemoryStream]::new()
      try {
        while (($bytesRead = $contentStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          if (($memory.Length + $bytesRead) -gt 1MB) {
            throw "$ToolName installer exceeded the allowed download size."
          }
          $memory.Write($buffer, 0, $bytesRead)
        }
        $installerBytes = $memory.ToArray()
      } finally {
        $memory.Dispose()
        $contentStream.Dispose()
      }
      if ($installerBytes.Length -eq 0) {
        throw "$ToolName installer was empty."
      }
      return [pscustomobject]@{
        Bytes = $installerBytes
        EffectiveUrl = $currentUri.AbsoluteUri
      }
    }
    throw "$ToolName installer exceeded the redirect limit."
  } finally {
    if ($null -ne $response) { $response.Dispose() }
    $httpClient.Dispose()
    $handler.Dispose()
  }
}

function Install-FromOfficialPowerShellScript {
  param(
    [string]$ToolName,
    [string]$ScriptUrl,
    [string]$ExpectedSha256,
    [string]$AllowedFinalOrigin
  )

  Invoke-Step "Installing or updating $ToolName from $ScriptUrl" {
    $installerBytes = $null
    $installerText = $null
    try {
      $payload = Get-OfficialInstallerPayload -ToolName $ToolName `
        -ScriptUrl $ScriptUrl -AllowedFinalOrigin $AllowedFinalOrigin
      $installerBytes = [byte[]]$payload.Bytes
      $sha256 = [System.Security.Cryptography.SHA256]::Create()
      try {
        $actualSha256 = [System.BitConverter]::ToString(
          $sha256.ComputeHash($installerBytes)
        ).Replace('-', '').ToLowerInvariant()
      } finally {
        $sha256.Dispose()
      }
      if ($actualSha256 -cne $ExpectedSha256) {
        throw "$ToolName installer SHA-256 digest changed."
      }

      $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
      $installerText = $strictUtf8.GetString($installerBytes)
      if ($installerText.Length -gt 0 -and $installerText[0] -eq [char]0xFEFF) {
        $installerText = $installerText.Substring(1)
      }

      $powerShell = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
      if (-not [System.IO.File]::Exists($powerShell)) {
        throw 'Could not resolve the current PowerShell executable.'
      }

      $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
      $startInfo.FileName = $powerShell
      # Feed the verified bytes over a private pipe. No pathname exists for a
      # second process to replace between digest verification and execution.
      $startInfo.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -'
      $startInfo.UseShellExecute = $false
      $startInfo.CreateNoWindow = $true
      $startInfo.RedirectStandardInput = $true
      # Provider output is intentionally drained without relaying it. Even a
      # verified installer can print local paths or account data.
      $startInfo.RedirectStandardOutput = $true
      $startInfo.RedirectStandardError = $true
      $startInfo.EnvironmentVariables.Clear()
      foreach ($environmentName in @(
        'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOME',
        'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA', 'PROGRAMFILES',
        'PROGRAMFILES(X86)', 'ProgramW6432', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'LANG',
        'OS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'NUMBER_OF_PROCESSORS',
        'DOTNET_ROOT', 'DOTNET_ROOT_ARM64', 'DOTNET_ROOT_X64'
      )) {
        $environmentValue = [System.Environment]::GetEnvironmentVariable($environmentName)
        if (-not [string]::IsNullOrEmpty($environmentValue)) {
          $startInfo.EnvironmentVariables[$environmentName] = $environmentValue
        }
      }
      $systemPath = @(
        (Join-Path $env:SystemRoot 'System32'),
        $env:SystemRoot,
        (Split-Path -Parent $powerShell)
      ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
      $startInfo.EnvironmentVariables['PATH'] = $systemPath -join ';'
      $startInfo.EnvironmentVariables['CODEX_NON_INTERACTIVE'] = '1'

      $installerProcess = [System.Diagnostics.Process]::new()
      $installerProcess.StartInfo = $startInfo
      try {
        if (-not $installerProcess.Start()) {
          throw "Could not start the isolated $ToolName installer process."
        }
        $stdoutDrain = $installerProcess.StandardOutput.BaseStream.CopyToAsync([System.IO.Stream]::Null)
        $stderrDrain = $installerProcess.StandardError.BaseStream.CopyToAsync([System.IO.Stream]::Null)
        $stdinWrite = $installerProcess.StandardInput.WriteAsync($installerText)
        if (-not $stdinWrite.Wait([TimeSpan]::FromSeconds(15))) {
          throw "$ToolName installer input pipe timed out."
        }
        $installerProcess.StandardInput.Close()

        $deadline = [DateTime]::UtcNow.AddMinutes(15)
        while (-not $installerProcess.WaitForExit(250)) {
          if ([DateTime]::UtcNow -ge $deadline) {
            throw "$ToolName installer exceeded its bounded execution time."
          }
        }
        if (-not [System.Threading.Tasks.Task]::WaitAll(
          [System.Threading.Tasks.Task[]]@($stdoutDrain, $stderrDrain),
          [TimeSpan]::FromSeconds(5)
        )) {
          throw "$ToolName installer output pipes did not close."
        }
        if ($installerProcess.ExitCode -ne 0) {
          throw "$ToolName installer exited with code $($installerProcess.ExitCode)"
        }
      } finally {
        Stop-InstallerProcess -Process $installerProcess
        $installerProcess.Dispose()
      }
    } finally {
      $installerText = $null
      $installerBytes = $null
    }
  }
  return $script:LastStepSucceeded
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

$toolList = @()
foreach ($rawTool in $Tools.Split(',', [System.StringSplitOptions]::RemoveEmptyEntries)) {
  $normalizedTool = $rawTool.Trim().ToLowerInvariant()
  if ($normalizedTool -in @('agy', 'gemini')) {
    $normalizedTool = 'antigravity'
  }
  if ($normalizedTool -notmatch '^[a-z0-9-]+$') {
    $normalizedTool = 'invalid-tool-id'
  }
  if ($normalizedTool -and $normalizedTool -notin $toolList) {
    $toolList += $normalizedTool
  }
}
$packageManager = Get-JsPackageManager

Write-Info 'Workspace selected'
Write-Info "Selected tools: $($toolList -join ',')"

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
      if (Install-FromOfficialPowerShellScript -ToolName 'Claude Code' `
        -ScriptUrl 'https://claude.ai/install.ps1' `
        -ExpectedSha256 'cd17c6b555f761d60373659824bf805e1510538226e4c7028e19d7494937a333' `
        -AllowedFinalOrigin 'https://downloads.claude.ai') {
        Test-InstalledCli -ToolName 'Claude Code' -ExpectedPaths @(
          (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
          (Join-Path $env:USERPROFILE '.local\bin\claude')
        )
      }
    }
    'codex' {
      if (Install-FromOfficialPowerShellScript -ToolName 'Codex CLI' `
        -ScriptUrl 'https://chatgpt.com/codex/install.ps1' `
        -ExpectedSha256 '391f247de2c70c7e99041979ec02dae7e76be27ac9cfc1dfe7c1eb21d48d8b97' `
        -AllowedFinalOrigin 'https://releases.openai.com') {
        Test-InstalledCli -ToolName 'Codex CLI' -ExpectedPaths @(
          (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe')
        )
      }
    }
    'copilot' {
      Install-PinnedCopilotCli
    }
    'antigravity' {
      if (Install-FromOfficialPowerShellScript -ToolName 'Antigravity CLI (agy)' `
        -ScriptUrl 'https://antigravity.google/cli/install.ps1' `
        -ExpectedSha256 '51c2cb4fada22ce0228da71b9506370383d6544bfebcec85fe7616a52b805344' `
        -AllowedFinalOrigin 'https://antigravity.google') {
        Test-InstalledCli -ToolName 'Antigravity CLI' -ExpectedPaths @(
          (Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe')
        )
      }
    }
    'grok' {
      if (Install-FromOfficialPowerShellScript -ToolName 'Grok Build' `
        -ScriptUrl 'https://x.ai/cli/install.ps1' `
        -ExpectedSha256 '3a4ee2b1d744252c00827abbdeb2589f6b3dae80e73d88e0a81e08dc0ee747e7' `
        -AllowedFinalOrigin 'https://x.ai') {
        Test-InstalledCli -ToolName 'Grok Build' -ExpectedPaths @(
          (Join-Path $env:USERPROFILE '.grok\bin\grok.exe')
        )
      }
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
Write-Info '  claude auth login'
Write-Info '  codex login'
Write-Info '  copilot login'
Write-Info '  agy'
Write-Info '  grok'
Write-Info '  gh auth login'
Write-Info '  az login'

if ($HasFailure) {
  Write-Warn 'Optional tool installation completed with warnings or failures'
  exit 1
}

Write-Info 'Optional tool installation complete'

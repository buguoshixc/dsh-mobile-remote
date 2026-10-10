#requires -Version 5.1
<#
.SYNOPSIS
  Isolated DSH test bench ("scratch instance") for dsh-mobile-remote.

.DESCRIPTION
  Boots a SECOND DSH instance on a non-19387 loopback port, against a scratch
  DSH_HOME, without touching the live desktop session (PID of the GUI holder),
  the live profile, the DSH installation or the frontend dist.

  The launcher is the shipped Electron binary in Node mode
  (ELECTRON_RUN_AS_NODE=1), which is exactly how the Desktop app itself runs
  `@deepseek-ai/dsh/lib/bin.js`; Electron's Node keeps ASAR support, so the CLI
  can be loaded straight out of `app.asar` with no extraction and no second
  resident service. See docs/02-harness.md for the measured route comparison.

  IRON RULES enforced here:
    * never stops/kills the live "DeepSeek Harness" process (the harness refuses
      any PID that is not provably this scratch instance's launcher);
    * never writes anywhere except <workspace>\_harness\** (plus the profile
      manifest of the scratch profile), and never writes into
      C:\Users\<user>\.dsh\profiles\desktop.

.PARAMETER Action
  status   - report scratch port owner, PID liveness, live 19387 owner (read-only)
  start    - ensure scratch DSH_HOME/profile, boot the instance, wait for the port
  stop     - stop only this scratch instance (guarded)
  restart  - stop + start
  probe    - HTTP probe of the scratch instance (401 bare / 200 probe route)
  install  - install a bundle directory into the scratch profile (junction + manifest)
  uninstall- remove a bundle from the scratch profile
  dumpconfig - write the composed scratch profile tree to <workspace>\_harness\logs\dumpcfg.out
             (its own files: never truncates the instance's mount log scratch.out)

.EXAMPLE
  pwsh -File tools\harness\harness.ps1 -Action start
  pwsh -File tools\harness\harness.ps1 -Action probe
  pwsh -File tools\harness\harness.ps1 -Action install -BundlePath tools\harness\fixtures\harness-probe
  pwsh -File tools\harness\harness.ps1 -Action stop
#>
[CmdletBinding()]
param(
  [ValidateSet('status', 'start', 'stop', 'restart', 'probe', 'install', 'uninstall', 'reset', 'dumpconfig')]
  [string]$Action = 'status',

  [string]$Profile = 'mobileharness',
  [int]$Port = 19388,
  [int]$WaitSeconds = 90,

  # Absolute or repo-relative path of the bundle directory to (un)install.
  [string]$BundlePath,

  # '<WS>\dsh-mobile-remote' - defaults to the parent of tools\harness.
  [string]$RepoRoot,
  # '<WS>' - defaults to the parent of RepoRoot; scratch state lives in <WS>\_harness.
  [string]$WorkspaceRoot,

  # Route (b): the shipped Electron binary in Node mode (verified, zero-copy).
  [string]$ElectronExe = 'D:\DSHD\DeepSeek Harness.exe',
  [string]$AsarBin = 'D:\DSHD\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js',
  # Route (a): console node + extracted runtime tree (see docs/02-harness.md).
  # Derived from USERPROFILE so this script stays pure ASCII: Windows PowerShell
  # 5.1 reads .ps1 files as ANSI unless they carry a BOM, so a non-ASCII user
  # name embedded as a literal would be mangled.
  [string]$NodeExe = (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
  [ValidateSet('electron', 'node-extracted')]
  [string]$Launcher = 'electron'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# -- paths --------------------------------------------------------------------
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
if (-not $WorkspaceRoot) { $WorkspaceRoot = (Resolve-Path (Join-Path $RepoRoot '..')).Path }
$HarnessRoot = Join-Path $WorkspaceRoot '_harness'
$ScratchHome = Join-Path $HarnessRoot 'home'
$ExtractedRoot = Join-Path $HarnessRoot 'extracted'
$LogDir = Join-Path $HarnessRoot 'logs'
$StateDir = Join-Path $HarnessRoot 'state'
$StateFile = Join-Path $StateDir 'scratch.json'
$ProfileDir = Join-Path $ScratchHome "profiles\$Profile"
$StdOut = Join-Path $LogDir 'scratch.out'
$StdErr = Join-Path $LogDir 'scratch.err'

# Live instance that must never be disturbed.
$LivePort = 19387

function Write-Step([string]$Text) { Write-Host "==> $Text" }

function Initialize-Layout {
  foreach ($d in @($HarnessRoot, $ScratchHome, $LogDir, $StateDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Get-CmdLine([int]$ProcessId) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if ($p) { return [string]$p.CommandLine }
  return ''
}

function Get-ScratchMarkers {
  # Command-line fingerprints of "this scratch instance", one per launcher route.
  return @($AsarBin, (Join-Path $ExtractedRoot 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'))
}

function Test-IsScratchCmdLine([string]$CmdLine) {
  if (-not $CmdLine) { return $false }
  if ($CmdLine -notlike "*--profile $Profile*") { return $false }
  if ($CmdLine -notlike "*--port $Port*") { return $false }
  foreach ($marker in Get-ScratchMarkers) { if ($CmdLine -like "*$marker*") { return $true } }
  return $false
}

function Get-ScratchProcesses {
  # Only processes provably belonging to THIS scratch instance: a known scratch
  # launcher entry plus `--profile <Profile>`. Anything else is left alone.
  foreach ($name in @('DeepSeek Harness.exe', 'node.exe')) {
    Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
      Where-Object { Test-IsScratchCmdLine ([string]$_.CommandLine) } |
      Select-Object ProcessId, CommandLine
  }
}

function Get-PortOwner([int]$LocalPort) {
  $c = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess }
  return 0
}

function Invoke-Http([string]$Path, [int]$TimeoutSec = 10) {
  # curl.exe is present on Windows 10+ and, unlike Invoke-WebRequest, does not
  # lose the status code of a 4xx response.
  $body = [System.IO.Path]::GetTempFileName()
  try {
    $code = & curl.exe -s -o $body -w '%{http_code}' --max-time $TimeoutSec "http://127.0.0.1:$Port$Path"
    $text = ''
    if (Test-Path $body) { $text = (Get-Content $body -Raw -ErrorAction SilentlyContinue) }
    return [pscustomobject]@{ Status = [int]$code; Body = $text }
  } finally {
    Remove-Item $body -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ScratchPort([int]$TimeoutSec) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ((Get-PortOwner $Port) -ne 0) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-ScratchToken {
  if (-not (Test-Path $StdOut)) { return $null }
  $m = Select-String -Path $StdOut -Pattern 'token=([A-Za-z0-9_\-]+)' | Select-Object -Last 1
  if ($m) { return $m.Matches[0].Groups[1].Value }
  return $null
}

function Start-Scratch {
  Initialize-Layout
  if ((Get-PortOwner $Port) -ne 0) {
    throw "port $Port is already in use (owner PID $((Get-PortOwner $Port))); run -Action stop first"
  }

  # 1. Scratch profile: initialize from the shipped `web` template on first use.
  #    The flag is passed only for that first boot, so a later start never
  #    rewrites a scratch profile that already carries test bundles.
  $profileManifest = Join-Path $ProfileDir 'package.json'
  $prefix = @()
  if (-not (Test-Path $profileManifest)) {
    Write-Step "initializing scratch profile '$Profile' from the shipped web template"
    $prefix = @('--from-default-profile', 'web')
  }

  # 2. Boot detached, then wait for the port.
  Write-Step "booting scratch instance: profile=$Profile port=$Port home=$ScratchHome launcher=$Launcher"
  $proc = Start-DshProcess -Arguments (@('--profile', $Profile) + $prefix + @('--port', "$Port") + @('--no-open')) -Detached
  Set-Content -Path $StateFile -Value (@{ pid = $proc.Id; port = $Port; profile = $Profile; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json) -Encoding UTF8

  if (-not (Wait-ScratchPort -TimeoutSec $WaitSeconds)) {
    Write-Host "--- last stdout ---"; if (Test-Path $StdOut) { Get-Content $StdOut -Tail 20 }
    Write-Host "--- last stderr ---"; if (Test-Path $StdErr) { Get-Content $StdErr -Tail 20 }
    throw "scratch instance did not listen on 127.0.0.1:$Port within ${WaitSeconds}s"
  }
  $token = Get-ScratchToken
  Write-Host "scratch instance up: pid=$($proc.Id) url=http://127.0.0.1:$Port/"
  if ($token) { Write-Host "authenticated startup URL: http://127.0.0.1:$Port/?token=$token" }
  Write-Host "logs: $StdOut / $StdErr"
}

function Start-DshProcess {
  param(
    [string[]]$Arguments,
    [switch]$Wait,
    [switch]$Detached,
    # Where the child's stdout/stderr go. Defaults to the scratch instance's
    # mount log; one-shot commands (dump-config) pass their own files so they
    # cannot truncate the running instance's log.
    [string]$OutputPath = $StdOut,
    [string]$ErrorPath = $StdErr
  )
  $env:DSH_HOME = $ScratchHome
  $env:DSH_PROFILE = $Profile
  # The launcher owns profile selection; stale desktop-session values must not leak.
  foreach ($name in @('DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_SHELL', 'DSH_WEB_URL')) {
    if (Test-Path "env:$name") { Remove-Item "env:$name" }
  }

  if ($Launcher -eq 'electron') {
    if (-not (Test-Path $ElectronExe)) { throw "Electron binary not found: $ElectronExe" }
    # Test-Path cannot see INSIDE an asar archive (it is a file to Windows), so
    # validate the archive and let the launcher report a missing entry itself.
    if ($AsarBin -notmatch '^(.+?\.asar)\\') { throw "AsarBin must point inside an .asar archive: $AsarBin" }
    if (-not (Test-Path $Matches[1])) { throw "asar archive not found: $($Matches[1])" }
    $env:ELECTRON_RUN_AS_NODE = '1'
    $file = $ElectronExe
    $all = @($AsarBin) + $Arguments
  } else {
    $extractedBin = Join-Path $ExtractedRoot 'dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
    if (-not (Test-Path $extractedBin)) { throw "extracted runtime missing; run tools\harness\extract-dsh-runtime.mjs --dest $ExtractedRoot first" }
    if (-not (Test-Path $NodeExe)) { throw "bundled node not found: $NodeExe" }
    $env:ELECTRON_RUN_AS_NODE = '1'  # ignored by node.exe; kept for packaged-pnpm parity
    $file = $NodeExe
    $all = @($extractedBin) + $Arguments
  }

  $common = @{
    FilePath               = $file
    ArgumentList           = $all
    NoNewWindow            = $true
    RedirectStandardOutput = $OutputPath
    RedirectStandardError  = $ErrorPath
  }
  if ($Wait) {
    $p = Start-Process @common -Wait -PassThru
    return [pscustomobject]@{ Id = $p.Id; ExitCode = $p.ExitCode }
  }
  $p = Start-Process @common -PassThru
  return [pscustomobject]@{ Id = $p.Id; ExitCode = $null }
}

function Stop-Scratch {
  $killed = @()
  # The recorded launcher PID and whoever owns the scratch port; both must look
  # like this scratch instance before they are touched.
  $candidates = @()
  if (Test-Path $StateFile) {
    try { $candidates += [int](Get-Content $StateFile -Raw | ConvertFrom-Json).pid } catch { }
  }
  $owner = Get-PortOwner $Port
  if ($owner -ne 0) { $candidates += $owner }

  foreach ($candidate in ($candidates | Sort-Object -Unique)) {
    if ($candidate -eq 0) { continue }
    if (-not (Get-Process -Id $candidate -ErrorAction SilentlyContinue)) { continue }
    if ($candidate -eq (Get-PortOwner $LivePort)) { Write-Warning "refusing to stop PID ${candidate}: it owns the live port $LivePort"; continue }
    $cmd = Get-CmdLine $candidate
    if (-not (Test-IsScratchCmdLine $cmd)) {
      Write-Warning "refusing to stop PID ${candidate}: not this scratch instance ($cmd)"
      continue
    }
    Stop-Process -Id $candidate -Force -ErrorAction Stop
    $killed += $candidate
  }
  # Any remaining helper processes of this instance (Electron spawns none in
  # Node mode, but be safe: they carry the same launcher path and profile flag).
  foreach ($p in Get-ScratchProcesses) {
    if ($killed -contains [int]$p.ProcessId) { continue }
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $killed += [int]$p.ProcessId
  }
  if ($killed.Count -gt 0) { Write-Host "stopped scratch PIDs: $($killed -join ', ')" } else { Write-Host 'no scratch instance was running' }
  Remove-Item $StateFile -Force -ErrorAction SilentlyContinue

  # Wait for the port to be released so a restart can rebind immediately.
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and (Get-PortOwner $Port) -ne 0) { Start-Sleep -Milliseconds 300 }
  if ((Get-PortOwner $Port) -ne 0) { Write-Warning "port $Port still bound by PID $((Get-PortOwner $Port))" }
}

function Install-Bundle([string]$Path) {
  if (-not $Path) { throw '-BundlePath <dir> is required' }
  $src = (Resolve-Path $Path).Path
  $manifest = Join-Path $src 'package.json'
  if (-not (Test-Path $manifest)) { throw "bundle has no package.json: $src" }
  $pkg = Get-Content $manifest -Raw | ConvertFrom-Json
  $name = $pkg.name
  if (-not $name) { throw "bundle package.json has no name: $manifest" }
  if (-not (Test-Path $ProfileDir)) { throw "scratch profile not initialized: $ProfileDir (run -Action start first)" }

  $nm = Join-Path $ProfileDir 'node_modules'
  if (-not (Test-Path $nm)) { New-Item -ItemType Directory -Force -Path $nm | Out-Null }
  $link = Join-Path $nm $name
  if (Test-Path $link) { Remove-Item -Force -Recurse $link }
  New-Item -ItemType Junction -Path $link -Target $src | Out-Null
  Write-Step "linked $link -> $src"

  $profileManifest = Join-Path $ProfileDir 'package.json'
  $profile = Get-Content $profileManifest -Raw | ConvertFrom-Json
  $spec = 'link:' + ($src -replace '\\', '/')
  $profile.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $spec -Force
  if ($profile.dsh.profile.bundles -notcontains $name) { $profile.dsh.profile.bundles += $name }
  Write-Utf8NoBom $profileManifest ($profile | ConvertTo-Json -Depth 20)
  Write-Step "profile manifest updated: bundles = $($profile.dsh.profile.bundles -join ', ')"
}

function Uninstall-Bundle([string]$Path) {
  if (-not $Path) { throw '-BundlePath <dir> is required' }
  $src = (Resolve-Path $Path).Path
  $name = (Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json).name
  $profileManifest = Join-Path $ProfileDir 'package.json'
  $profile = Get-Content $profileManifest -Raw | ConvertFrom-Json
  $profile.dsh.profile.bundles = @($profile.dsh.profile.bundles | Where-Object { $_ -ne $name })
  $profile.dependencies.PSObject.Properties.Remove($name)
  Write-Utf8NoBom $profileManifest ($profile | ConvertTo-Json -Depth 20)
  $link = Join-Path $ProfileDir "node_modules\$name"
  if (Test-Path $link) { Remove-Item -Force -Recurse $link }
  Write-Step "removed $name from the scratch profile"
}

function Reset-ScratchProfile {
  # Normalize the scratch profile back to "no test bundle, empty user patch" so
  # the verification run is idempotent. Touches ONLY the scratch profile.
  if (-not (Test-Path $ProfileDir)) { Write-Host 'scratch profile does not exist yet - nothing to reset'; return }
  $profileManifest = Join-Path $ProfileDir 'package.json'
  $profile = Get-Content $profileManifest -Raw | ConvertFrom-Json
  $deps = @()
  if ($profile.PSObject.Properties.Name -contains 'dependencies' -and $profile.dependencies) {
    $deps = @($profile.dependencies.PSObject.Properties | ForEach-Object { $_.Name })
  }
  foreach ($dep in $deps) {
    if ($dep -ne '@deepseek-ai/dsh-base' -and $dep -ne '@deepseek-ai/dsh-web-app') {
      $profile.dsh.profile.bundles = @($profile.dsh.profile.bundles | Where-Object { $_ -ne $dep })
      $profile.dependencies.PSObject.Properties.Remove($dep)
      $link = Join-Path $ProfileDir "node_modules\$dep"
      if (Test-Path $link) { Remove-Item -Force -Recurse $link }
      Write-Step "reset: dropped bundle '$dep'"
    }
  }
  Write-Utf8NoBom $profileManifest ($profile | ConvertTo-Json -Depth 20)
  Write-Utf8NoBom (Join-Path $ProfileDir 'cordis.patch.yml') "# scratch user patch layer (reset by harness.ps1 -Action reset)`n[]`n"
  Write-Step "scratch profile reset: bundles = $($profile.dsh.profile.bundles -join ', ')"
}

function Show-Status {
  $owner = Get-PortOwner $Port
  $liveOwner = Get-PortOwner $LivePort
  Write-Host "scratch  : port $Port owner PID $owner  $(if ($owner -eq 0) { '(down)' } else { (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName })"
  Write-Host "live DSH : port $LivePort owner PID $liveOwner  $(if ($liveOwner -ne 0) { (Get-Process -Id $liveOwner -ErrorAction SilentlyContinue).ProcessName })"
  Write-Host "scratch home: $ScratchHome"
  Write-Host "profile     : $ProfileDir"
  if (Test-Path $StateFile) { Write-Host "state       : $(Get-Content $StateFile -Raw)" }
  foreach ($p in Get-ScratchProcesses) { Write-Host "scratch proc: PID $($p.ProcessId)" }
}

function Show-Probe {
  $bare = Invoke-Http '/'
  Write-Host "GET /              -> $($bare.Status)   (401 = loopback-only auth fence is doing its job)"
  $route = Invoke-Http '/harness-probe'
  Write-Host "GET /harness-probe -> $($route.Status)"
  if ($route.Body) { Write-Host $route.Body.TrimEnd() }
  if ($bare.Status -eq 401 -and $route.Status -eq 200) { return 0 } else { return 1 }
}

function Invoke-DumpConfig {
  Initialize-Layout
  # V-3/F8: the dump is a one-shot command, not the instance's mount log. It gets
  # its own pair of files — the mount log ($StdOut = logs\scratch.out) belongs to
  # the running scratch instance, and redirecting the dump there truncated it
  # (the message used to name dumpcfg.out while the redirect wrote scratch.out).
  $out = Join-Path $LogDir 'dumpcfg.out'
  $err = Join-Path $LogDir 'dumpcfg.err'
  $p = Start-DshProcess -Arguments @('--profile', $Profile, '--dump-config') -Wait -OutputPath $out -ErrorPath $err
  if ($p.ExitCode -ne 0) { throw "dump-config failed (exit $($p.ExitCode)); see $err" }
  $outBytes = if (Test-Path $out) { (Get-Item $out).Length } else { 0 }
  $errBytes = if (Test-Path $err) { (Get-Item $err).Length } else { 0 }
  Write-Host "composed scratch profile tree: $out ($outBytes bytes)"
  Write-Host "dump-config stderr:           $err ($errBytes bytes)"
  Write-Host "mount log untouched:          $StdOut"
}

switch ($Action) {
  'status' { Show-Status }
  'start' { Start-Scratch }
  'stop' { Stop-Scratch }
  'restart' { Stop-Scratch; Start-Scratch }
  'probe' { $code = Show-Probe; exit $code }
  'install' { Install-Bundle $BundlePath }
  'uninstall' { Uninstall-Bundle $BundlePath }
  'reset' { Reset-ScratchProfile }
  'dumpconfig' { Invoke-DumpConfig }
}

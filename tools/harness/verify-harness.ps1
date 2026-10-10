#requires -Version 5.1
<#
.SYNOPSIS
  ONE-COMMAND proof that host-side plugin code runs end-to-end without touching
  the live DSH desktop session (PID holding 127.0.0.1:19387).

.DESCRIPTION
  Sequence (each step asserts an observable signal, no summary-only claims):

    1. start scratch instance      -> 127.0.0.1:19388 listens
    2. GET /  on the scratch port  -> 401   (loopback auth fence alive)
    3. GET /harness-probe          -> 404   (route not claimed yet)
    4. install tools\harness\fixtures\harness-probe into the scratch profile
                                   -> the running instance recomposes IN PLACE,
                                      no restart (same PID)
    5. GET /harness-probe          -> 200 + JSON naming the marker/pid/home
    6. uninstall the bundle        -> route disappears (404) live
    7. stop the scratch instance   -> 19388 released, 19387 still owned by the
                                      live desktop process

  Exit code 0 = all seven steps passed. Any deviation fails the run and prints
  the raw evidence collected so far.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\verify-harness.ps1
#>
[CmdletBinding()]
param(
  [string]$Profile = 'mobileharness',
  [int]$Port = 19388,
  [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Harness = Join-Path $PSScriptRoot 'harness.ps1'
$Fixture = Join-Path $PSScriptRoot 'fixtures\harness-probe'
$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$WaitSeconds = 90

$results = New-Object System.Collections.Generic.List[object]
$failures = New-Object System.Collections.Generic.List[string]

function Step([string]$Name, [bool]$Ok, [string]$Evidence) {
  $results.Add([pscustomobject]@{ Step = $Name; Result = $(if ($Ok) { 'PASS' } else { 'FAIL' }); Evidence = $Evidence })
  if (-not $Ok) { $failures.Add($Name) }
  Write-Host ("[{0}] {1}`n      {2}" -f $(if ($Ok) { 'PASS' } else { 'FAIL' }), $Name, $Evidence)
}

function Http([string]$Path) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    $code = & curl.exe -s -o $tmp -w '%{http_code}' --max-time 8 "http://127.0.0.1:$Port$Path"
    $body = ''
    if (Test-Path $tmp) { $body = (Get-Content $tmp -Raw -ErrorAction SilentlyContinue) }
    return [pscustomobject]@{ Status = [int]$code; Body = $body }
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

function PortOwner([int]$LocalPort) {
  $c = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess } else { return 0 }
}

function Run([string[]]$Extra) {
  # Delegate to harness.ps1 and surface its exit code.
  #
  # Two Windows/PowerShell traps this helper exists to avoid:
  #  * `Start-Process -Wait` waits for the process AND ITS DESCENDANTS, and
  #    harness.ps1 leaves the scratch instance running on purpose -> use
  #    $p.WaitForExit(ms), which waits for that one process only.
  #  * capturing output with `& ...` / a pipeline makes the detached
  #    grandchild inherit the capture pipe's write end and hold it open; file
  #    redirection has no such handle leak.
  $stamp = [guid]::NewGuid().ToString('N')
  $log = Join-Path $env:TEMP "harness-$stamp.log"
  $err = Join-Path $env:TEMP "harness-$stamp.err"
  try {
    $p = Start-Process -FilePath 'powershell.exe' -NoNewWindow -PassThru `
      -ArgumentList (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Harness) + $Extra) `
      -RedirectStandardOutput $log -RedirectStandardError $err
    $exited = $p.WaitForExit(180000)
    foreach ($line in @(Get-Content $log -ErrorAction SilentlyContinue) + @(Get-Content $err -ErrorAction SilentlyContinue)) {
      Write-Host "      | $line"
    }
    if (-not $exited) { Write-Warning "harness.ps1 $($Extra -join ' ') did not exit within 180s"; return 124 }
    return $p.ExitCode
  } finally {
    Remove-Item $log, $err -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "dsh-mobile-remote - isolated harness verification"
Write-Host "workspace : $WorkspaceRoot"
Write-Host "fixture   : $Fixture"
Write-Host "scratch   : 127.0.0.1:$Port (profile '$Profile')"
Write-Host ''

$liveOwnerBefore = PortOwner 19387
Write-Host "live desktop instance before: 127.0.0.1:19387 owner PID $liveOwnerBefore"
Write-Host ''

try {
  # -- 1. start --------------------------------------------------------------
  # -- 0. normalize the scratch profile (idempotent reruns) ------------------
  $null = Run @('-Action', 'stop', '-Profile', $Profile, '-Port', "$Port")
  $null = Run @('-Action', 'reset', '-Profile', $Profile, '-Port', "$Port")

  $null = Run @('-Action', 'start', '-Profile', $Profile, '-Port', "$Port")
  $owner1 = PortOwner $Port
  Step 'start scratch instance' ($owner1 -ne 0) "127.0.0.1:$Port owner PID $owner1"

  # -- 2. auth fence ---------------------------------------------------------
  $bare = Http '/'
  Step 'GET / is refused unauthenticated (401)' ($bare.Status -eq 401) "status=$($bare.Status)"

  # -- 3. route absent before install ----------------------------------------
  $before = Http '/harness-probe'
  Step 'GET /harness-probe is not served before install' ($before.Status -ne 200) "status=$($before.Status)"

  # -- 4. live bundle install (no restart) -----------------------------------
  $null = Run @('-Action', 'install', '-Profile', $Profile, '-Port', "$Port", '-BundlePath', $Fixture)
  $probe = $null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $probe = Http '/harness-probe'
    if ($probe.Status -eq 200) { break }
    Start-Sleep -Milliseconds 500
  }
  $owner2 = PortOwner $Port
  Step 'bundle install recomposes the RUNNING instance in place' ($probe.Status -eq 200 -and $owner2 -eq $owner1) `
    "status=$($probe.Status) pidBefore=$owner1 pidAfter=$owner2 (no restart)"

  # -- 5. host code answered over HTTP ---------------------------------------
  $json = $null
  try { $json = $probe.Body | ConvertFrom-Json } catch { }
  $markerOk = $json -and $json.marker -eq 'harness-probe-v1'
  $homeOk = $json -and $json.dshHome -like '*_harness\home*'
  $pidOk = $json -and [int]$json.pid -eq $owner2
  Step 'probe route answered by the scratch host process' ($markerOk -and $homeOk -and $pidOk) `
    $(if ($json) { "marker=$($json.marker) pid=$($json.pid) home=$($json.dshHome) port=$($json.webserverPort)" } else { "raw: $($probe.Body)" })

  # -- 6. live uninstall -----------------------------------------------------
  $null = Run @('-Action', 'uninstall', '-Profile', $Profile, '-Port', "$Port", '-BundlePath', $Fixture)
  $gone = $null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $gone = Http '/harness-probe'
    if ($gone.Status -ne 200) { break }
    Start-Sleep -Milliseconds 500
  }
  Step 'bundle uninstall removes the route live' ($gone.Status -ne 200) "status=$($gone.Status)"

  # -- 7. teardown / live instance intact ------------------------------------
  if (-not $KeepRunning) {
    $null = Run @('-Action', 'stop', '-Profile', $Profile, '-Port', "$Port")
  }
  $owner3 = PortOwner $Port
  $liveOwnerAfter = PortOwner 19387
  Step 'scratch port released and live 19387 untouched' `
    (($owner3 -eq 0 -or $KeepRunning) -and ($liveOwnerAfter -eq $liveOwnerBefore)) `
    "port$Port owner=$owner3, 19387 owner $liveOwnerBefore -> $liveOwnerAfter"
}
catch {
  $failures.Add("unhandled: $($_.Exception.Message)")
  Write-Host "ERROR: $($_.Exception.Message)"
  try { $null = Run @('-Action', 'stop', '-Profile', $Profile, '-Port', "$Port") } catch { }
}

Write-Host ''
Write-Host '-- summary -----------------------------------------------'
$results | Format-Table -AutoSize | Out-String | Write-Host

if ($failures.Count -gt 0) {
  Write-Host "HARNESS VERIFY: FAILED ($($failures.Count) step(s))"
  exit 1
}
Write-Host 'HARNESS VERIFY: PASSED (host plugin code ran end-to-end on an isolated instance)'
exit 0
#requires -Version 5.1
<#
.SYNOPSIS
  T6 live verification driver: the REAL plugin mounted in a throwaway DSH
  instance, asserted through HTTP status lines, the process table and raw bytes.

.DESCRIPTION
  Every assertion prints `[PASS]`/`[FAIL] <id> | <detail>`; the transcript (with
  the raw responses) goes to `_harness\t3\verify-t6.log`. Nothing here touches
  PID 1428 or `profiles\desktop`: the scratch instance lives in `_harness\home`
  under profile `mobileharness` and is stopped at the end.

  Sections (use -Only to rerun one):
    base    start the scratch instance, baseline 404 / 401
    live    install the real plugin -> route appears live (same PID)
    auth    refusal/authenticated JSON, token exchange, tampered token
    fence   forged Host / no cookie on /api, live trustedHosts 403<->401 flip
    client  roster entry + real client bundle served (t19 URL form)
    traps   trap A (wrong authority literal) and trap B ('//' comment)
    tier3   lib/*.js module generation needs a restart
    cleanup stop, release ports, leave 19387 untouched

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\verify-t6.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\verify-t6.ps1 -Only fence
#>
[CmdletBinding()]
param(
  [string]$Repo = '',
  [string]$Profile = 'mobileharness',
  [int]$Port = 19390,
  [string]$Only = '',
  [int]$WaitSeconds = 40
)

$ErrorActionPreference = 'Continue'
# Windows PowerShell 5.1 does not populate $PSScriptRoot while binding param
# defaults, so the script's own directory is resolved here instead.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Repo) { $Repo = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path }
$WorkspaceRoot = (Resolve-Path (Join-Path $ScriptDir '..\..\..')).Path
$Harness = Join-Path $ScriptDir 'harness.ps1'
$ScratchHome = Join-Path $WorkspaceRoot '_harness\home'
$ProfileDir = Join-Path $ScratchHome "profiles\$Profile"
$LogDir = Join-Path $WorkspaceRoot '_harness\logs'
$ScratchOut = Join-Path $LogDir 'scratch.out'
$ScratchErr = Join-Path $LogDir 'scratch.err'
$Work = Join-Path $WorkspaceRoot '_harness\t3'
$Fixture = Join-Path $Work 'fixture-gen'
$CookieJar = Join-Path $env:TEMP 't6-cookies.txt'
$Authority = 'demo.tailnet-example.ts.net'
$WrongLiteral = 'AAAA-not-an-authority-BBBB'
$Base = "http://127.0.0.1:$Port"

New-Item -ItemType Directory -Force -Path $Work | Out-Null
$script:Pass = 0
$script:Fail = 0

function Check([string]$Id, [bool]$Ok, [string]$Detail) {
  if ($Ok) { $script:Pass++; Write-Host "[PASS] $Id | $Detail" }
  else { $script:Fail++; Write-Host "[FAIL] $Id | $Detail" }
}
function Invoke-Harness([string[]]$HarnessArgs) { & $Harness -Profile $Profile -Port $Port @HarnessArgs | Out-Null }
function Invoke-Action([string]$ActionName, [string]$Bundle = '') {
  Step "harness -Action $ActionName$(if ($Bundle) { " -BundlePath $Bundle" })"
  if ($Bundle) { & $Harness -Profile $Profile -Port $Port -Action $ActionName -BundlePath $Bundle 2>&1 | ForEach-Object { Write-Host "    $_" } }
  else { & $Harness -Profile $Profile -Port $Port -Action $ActionName 2>&1 | ForEach-Object { Write-Host "    $_" } }
}
# The instance must outlive this script step: a scratch DSH started inside the
# current pwsh call is tied to that call's process tree and dies with it (the
# same pipe/console inheritance t18 recorded). Start it detached instead, and
# truncate the logs first so later assertions cannot be satisfied by stale lines.
function Start-Scratch {
  Remove-Item $ScratchOut, $ScratchErr -ErrorAction SilentlyContinue
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Harness,
    '-Action', 'start', '-Profile', $Profile, '-Port', $Port
  ) | Out-Null
}
function Restart-Scratch {
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Harness,
    '-Action', 'restart', '-Profile', $Profile, '-Port', $Port
  ) | Out-Null
}
function Stop-Scratch {
  Invoke-Action 'stop'
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (ScratchPid)) { return $true }
    Start-Sleep -Milliseconds 300
  }
  $owner = ScratchPid
  if (-not $owner) { return $true }
  $cmd = [string](Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue).CommandLine
  # Same guard the harness uses: only ever this scratch instance, never 19387.
  if ($cmd -match '19387' -or $cmd -notmatch "profile $Profile" -or $cmd -notmatch "port $Port") {
    Write-Host "[FAIL] stop: refusing to kill PID $owner | $cmd"
    return $false
  }
  Write-Host "    stop: harness left PID $owner listening; killing it directly (guarded)"
  Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  return ($null -eq (ScratchPid))
}
function Status([string]$Url, [string[]]$Headers = @(), [string[]]$Extra = @()) {
  $args = @('-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '10')
  foreach ($h in $Headers) { $args += @('-H', $h) }
  $args += $Extra
  $args += $Url
  return (& curl.exe @args | Out-String).Trim()
}
function Body([string]$Url, [string[]]$Headers = @(), [string[]]$Extra = @()) {
  $args = @('-s', '--max-time', '10')
  foreach ($h in $Headers) { $args += @('-H', $h) }
  $args += $Extra
  $args += $Url
  return (& curl.exe @args | Out-String)
}
function Step([string]$Text) { Write-Host "==> $Text" }
function Raw([string]$Url, [string[]]$Headers = @(), [string[]]$Extra = @()) {
  $args = @('-s', '-i', '--max-time', '10')
  foreach ($h in $Headers) { $args += @('-H', $h) }
  $args += $Extra
  $args += $Url
  return (& curl.exe @args | Out-String)
}
function ScratchPid { return (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess }
function Wait-Status([string]$Url, [string[]]$Headers, [string]$Expect, [int]$TimeoutSec = $WaitSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ((Status $Url $Headers) -eq $Expect) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}
function Write-Fixture([string]$Marker) {
  $js = @"
export const name = 'dsh-t3-fixture-gen'
export const inject = ['webServer']
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/t3-gen',
    handler: (req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('$Marker') },
  }))
}
"@
  [System.IO.File]::WriteAllText((Join-Path $Fixture 'lib\index.js'), $js, (New-Object System.Text.UTF8Encoding($false)))
}
function Write-ScratchPatch([string]$Trusted) {
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
  $yaml = @"
# t3 verification scratch patch. '#' comments only (never '//').
- id: web-runtime
  name: "@deepseek-ai/dsh-web-app"
  inject: [webStartup]
  config:
    openBrowser: false
    printUrl: true
    surfaceContext: true
    trustedHosts: [ '$Trusted' ]
"@
  [System.IO.File]::WriteAllText((Join-Path $ProfileDir 'cordis.patch.yml'), $yaml, (New-Object System.Text.UTF8Encoding($false)))
}
function Ensure-Scratch {
  if ((ScratchPid) -and (Status "$Base/" @()) -eq '401') { return $true }
  Stop-Scratch | Out-Null
  Invoke-Action 'reset'
  if (-not (Test-Path (Join-Path $ProfileDir 'cordis.patch.yml'))) { Write-ScratchPatch $Authority }
  Start-Scratch
  return (Wait-Status "$Base/" @() '401')
}
function Ensure-Plugin {
  # returns $true when /mobile-remote/pair answers 401
  if ((Status "$Base/mobile-remote/pair" @()) -eq '401') { return $true }
  Step "install real plugin into the scratch profile ($Repo)"
  & $Harness -Profile $Profile -Port $Port -Action install -BundlePath $Repo 2>&1 | ForEach-Object { Write-Host "    $_" }
  $ok = Wait-Status "$Base/mobile-remote/pair" @() '401' 40
  if (-not $ok) {
    Step 'install did not take effect within the wait; retrying once (recording both statuses)'
    Write-Host "    status before retry: $((Status "$Base/mobile-remote/pair" @()))"
    & $Harness -Profile $Profile -Port $Port -Action install -BundlePath $Repo 2>&1 | ForEach-Object { Write-Host "    $_" }
    $ok = Wait-Status "$Base/mobile-remote/pair" @() '401' 40
    Write-Host "    status after retry: $((Status "$Base/mobile-remote/pair" @()))"
  }
  return $ok
}

$livePidBefore = (Get-Process -Id 1428).StartTime
$netBefore = (netstat -ano | findstr '19387')
$runAll = ($null -eq $Only -or $Only.Trim() -eq '')
function Want([string]$Name) { return ($runAll -or (($Only.Split(',') | ForEach-Object { $_.Trim() }) -contains $Name)) }

Write-Host "== T6 live verification (profile=$Profile port=$Port) =="

# ---------------------------------------------------------------- base
if (Want 'base') {
  Stop-Scratch | Out-Null
  Invoke-Action 'reset'
  Invoke-Action 'uninstall' $Repo
  Write-ScratchPatch $Authority
  Start-Scratch
  Check 'base.start' (Wait-Status "$Base/" @() '401') "GET / -> $(Status "$Base/") (expect 401)"
  $routeStatus = Status "$Base/mobile-remote/pair"
  Check 'base.route-absent' ($routeStatus -eq '404') "GET /mobile-remote/pair -> $routeStatus (expect 404 before install)"
  Check 'base.pid' ($null -ne (ScratchPid)) "scratch listener owned by PID $(ScratchPid)"
}

# ---------------------------------------------------------------- live mount
if (Want 'live' -or Want 'auth' -or Want 'fence' -or Want 'client' -or Want 'traps' -or Want 'tier3') {
  if (-not (Ensure-Scratch)) { Check 'ensure.scratch' $false 'scratch instance did not come up on 401' }
}
if (Want 'live') {
  $pidBefore = ScratchPid
  $installed = Ensure-Plugin
  $pidAfter = ScratchPid
  $routeNow = Status "$Base/mobile-remote/pair"
  Check 'live.route-appears' ($installed -and $routeNow -eq '401') "GET /mobile-remote/pair -> $routeNow (expect 401; installed=$installed)"
  Check 'live.same-pid' ($null -ne $pidBefore -and $pidBefore -eq $pidAfter) "PID before=$pidBefore after=$pidAfter (entry row mounted in place)"
  $mountLine = (Select-String -Path $ScratchOut -Pattern 'dsh-mobile-remote mounted' -ErrorAction SilentlyContinue | Select-Object -Last 1).Line
  if ($mountLine) {
    $script:deferDumpCheck = $false
    Check 'live.loader-ran-our-module' $true "stdout banner: $($mountLine.Trim())"
  } else {
    # The banner goes through ctx.logger (no exporter in a scratch instance), and
    # `-Action dumpconfig` overwrites scratch.out, so that loader-level check runs
    # last (cleanup) - after every section that needs the launch token.
    $script:deferDumpCheck = $true
    Step 'mount banner is not on stdout (ctx.logger has no exporter here): the composed-tree check runs at cleanup'
  }
}

# ---------------------------------------------------------------- auth / token
if (Want 'auth') {
  $refusedBody = Body "$Base/mobile-remote/pair" @("Host: $Authority")
  Check 'auth.refusal-body' ($refusedBody.Trim() -eq 'unauthorized') "body='$($refusedBody.Trim())'"
  Check 'auth.refusal-no-link' (-not ($refusedBody -match 'https?://')) "no http(s) link in the refusal body"
  Check 'auth.refusal-no-token' (-not ($refusedBody -match 'token=')) "no token substring in the refusal body"

  $token = $null
  $m = Select-String -Path $ScratchOut -Pattern 'token=([A-Za-z0-9_\-]{20,})' -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($m) { $token = $m.Matches[0].Groups[1].Value }
  Check 'auth.launch-token-found' ($null -ne $token) "token length $(if ($token) { $token.Length } else { 0 }) from scratch.out"
  if ($token) {
    Remove-Item $CookieJar -ErrorAction SilentlyContinue
    $exchange = Raw "$Base/?token=$token" @() @('-c', $CookieJar)
    Check 'auth.token-exchange-303' ($exchange -match 'HTTP/1\.1 303') "first line: $(($exchange -split "`n")[0].Trim())"
    Check 'auth.set-cookie' ($exchange -match 'set-cookie:\s*dsh-auth-') "Set-Cookie present: $([bool]($exchange -match 'set-cookie'))"
    $authedStatus = Status "$Base/mobile-remote/pair" @() @('-b', $CookieJar)
    $authed = Body "$Base/mobile-remote/pair" @() @('-b', $CookieJar)
    $ok200 = $false; $json = $null
    try { $json = $authed | ConvertFrom-Json; $ok200 = $true } catch { $ok200 = $false }
    Check 'auth.authenticated-200' ($ok200 -and $null -ne $json.url) "status=$authedStatus body: $($authed.Trim())"
    if ($ok200 -and $null -ne $json.url) {
      $keys = ($json.PSObject.Properties.Name | Sort-Object) -join ','
      Check 'auth.body-keys' ($keys -eq 'authority,expiresAt,url') "keys=$keys"
      Check 'auth.authority' ($json.authority -eq $Authority) "authority=$($json.authority)"
      $tokenParam = ([uri]$json.url).Query.TrimStart('?').Split('&')[0]
      Check 'auth.token-param-name' ($tokenParam -like 'token=*') "URL query starts with '$tokenParam' (TOKEN_QUERY='token' is kept as the sole auth input)"
    }
    $tampered = $token.Substring(0, $token.Length - 1) + $(if ($token[-1] -eq 'A') { 'B' } else { 'A' })
    $tamperRaw = Raw "$Base/?token=$tampered" @()
    Check 'neg4.tampered-token-401' ($tamperRaw -match 'HTTP/1\.1 401') "status line: $(($tamperRaw -split "`n")[0].Trim())"
    Check 'neg4.tampered-token-no-cookie' (-not ($tamperRaw -match 'set-cookie')) "no Set-Cookie on the tampered exchange"
  }
}

# ---------------------------------------------------------------- fence / negative security
if (Want 'fence') {
  $apiNoCookie = Status "$Base/api/" @()
  Check 'neg2.api-no-cookie-401' ($apiNoCookie -eq '401') "GET /api/ (no cookie) -> $apiNoCookie (expect 401)"
  $apiEvil = Status "$Base/api/" @('Host: evil.example.com')
  Check 'neg3.api-forged-host-403' ($apiEvil -eq '403') "GET /api/ Host=evil.example.com -> $apiEvil (expect 403)"
  $routeEvil = Status "$Base/mobile-remote/pair" @('Host: evil.example.com')
  Check 'neg3.route-forged-host-403' ($routeEvil -eq '403') "GET /mobile-remote/pair Host=evil.example.com -> $routeEvil (expect 403)"
  Check 'neg1.19387-loopback-only' (((netstat -ano | findstr '19387') -join ' ') -match 'TCP\s+127\.0\.0\.1:19387' -and -not (((netstat -ano | findstr '19387') -join ' ') -match '0\.0\.0\.0:19387')) 'netstat: 19387 listens on 127.0.0.1 only'
  Check 'neg1.19387-owner-1428' (((netstat -ano | findstr '19387') -join ' ') -match '1428') 'the live listener still belongs to PID 1428'

  # tier 1: config-only change flips the host fence live (same PID)
  $pidBefore = ScratchPid
  Write-ScratchPatch $Authority
  $flipTo401 = Wait-Status "$Base/api/" @("Host: $Authority") '401' 25
  Check 'tier1.trusted-host-401' $flipTo401 "GET /api/ Host=$Authority -> $(Status "$Base/api/" @("Host: $Authority")) (expect 401: fence passed, no cookie)"
  Write-ScratchPatch $WrongLiteral
  $flipBack = Wait-Status "$Base/api/" @("Host: $Authority") '403' 25
  Check 'trapA.wrong-literal-403' $flipBack "GET /api/ Host=$Authority after wrong trustedHosts -> $(Status "$Base/api/" @("Host: $Authority")) (expect 403)"
  Check 'tier1.same-pid' ($pidBefore -eq (ScratchPid)) "PID before=$pidBefore after=$(ScratchPid) (no restart for a config-only change)"
  $stderrErrors = (Select-String -Path $ScratchErr -Pattern 'Error|error:' -ErrorAction SilentlyContinue | Measure-Object).Count
  Check 'trapA.silent' ($stderrErrors -eq 0) "scratch.err error-ish lines: $stderrErrors (the trap is silent)"
  Check 'trapA.root-still-401' ((Status "$Base/" @()) -eq '401') "GET / -> $(Status "$Base/") (still 401: instance alive)"
  Write-ScratchPatch $Authority
  $recovered = Wait-Status "$Base/api/" @("Host: $Authority") '401' 25
  Check 'tier1.recovered-401' $recovered "GET /api/ Host=$Authority after restoring -> 401 (403<->401 flips both ways, same PID $(ScratchPid))"
}

# ---------------------------------------------------------------- client half
if (Want 'client') {
  # The client roster is registered at boot, so a bundle installed live cannot be
  # in it yet: restart (which rotates the launch token) and re-authenticate.
  Restart-Scratch
  $null = Wait-Status "$Base/" @() '401' $WaitSeconds
  $fresh = (Select-String -Path $ScratchOut -Pattern 'token=([A-Za-z0-9_\-]{20,})' -ErrorAction SilentlyContinue | Select-Object -Last 1)
  if ($fresh) {
    $freshToken = $fresh.Matches[0].Groups[1].Value
    Remove-Item $CookieJar -ErrorAction SilentlyContinue
    $null = Raw "$Base/?token=$freshToken" @() @('-c', $CookieJar)
  }
  $html = Body "$Base/" @() @('-b', $CookieJar)
  $entry = [regex]::Match($html, '"url":"plugins/\?\?dsh-mobile-remote/client\.js&rev=([0-9a-f]+)"')
  Check 'client.roster-entry' $entry.Success "roster entry: $(if ($entry.Success) { $entry.Value } else { '<absent>' })"
  if ($entry.Success) {
    $rev = $entry.Groups[1].Value
    $chunk = Body "$Base/plugins/??dsh-mobile-remote/client.js&rev=$rev" @()
    Check 'client.bundle-served' ($chunk -match 'window\.__ModuleLoader__\.load\(\{') "GET /plugins/??dsh-mobile-remote/client.js&rev=$rev -> first 60 bytes: $($chunk.Substring(0, [Math]::Min(60, $chunk.Length)))"
    Check 'client.bundle-id' ($chunk -match 'id:\s*"dsh-mobile-remote"') 'served bytes carry the frozen handshake id'
    Check 'client.bundle-size' ($chunk.Length -gt 40000) "served length=$($chunk.Length) bytes (lib/client.js bytes + sourceMappingURL rewrite)"
  }
}

# ---------------------------------------------------------------- traps
if (Want 'traps') {
  $trapB = Join-Path $WorkspaceRoot '_harness\t18-trap-comment'
  if (Test-Path $trapB) {
    Invoke-Action 'install' $trapB
    Restart-Scratch
    Start-Sleep -Seconds 3
    $skip = (Select-String -Path $ScratchErr -Pattern 'skipping profile bundle' -ErrorAction SilentlyContinue | Select-Object -Last 1).Line
    Check 'trapB.boot-diagnostic' ($null -ne $skip) "scratch.err: $(if ($skip) { $skip.Trim() } else { '<absent>' })"
    Check 'trapB.client-half-404' ((Status "$Base/plugins/??t18-trap-comment/client.js&rev=000000000000" @()) -eq '404') 'the skipped bundle never reaches the client roster (chunk 404)'
  } else { Check 'trapB.fixture' $false "$trapB missing" }
}

# ---------------------------------------------------------------- tier 3: lib/*.js module generation
if (Want 'tier3') {
  if (-not (Test-Path (Join-Path $Fixture 'package.json'))) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Fixture 'lib') | Out-Null
    $pkg = @'
{
  "name": "dsh-t3-fixture-gen",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
'@
    [System.IO.File]::WriteAllText((Join-Path $Fixture 'package.json'), $pkg, (New-Object System.Text.UTF8Encoding($false)))
    $patch = @'
# t3 tier-3 fixture: the marker lives in lib/index.js, so the served body shows
# which module generation the running process has cached.
- insert:
    - id: 't3-fixture-gen'
      name: 'dsh-t3-fixture-gen'
'@
    [System.IO.File]::WriteAllText((Join-Path $Fixture 'cordis.patch.yml'), $patch, (New-Object System.Text.UTF8Encoding($false)))
  }
  $markerDoc = 'lib/index.js carries the marker, so the served body names the cached generation'
  Write-Host "== tier3 fixture: $markerDoc =="
  Write-Fixture 'A'
  Invoke-Action 'install' $Fixture
  $mountedA = Wait-Status "$Base/t3-gen" @() '200' 25
  $bodyA = (Body "$Base/t3-gen" @()).Trim()
  Check 'tier3.mount-marker-A' ($mountedA -and $bodyA -eq 'A') "GET /t3-gen -> '$bodyA' (expect A after the live install)"
  $pidBefore = ScratchPid
  Write-Fixture 'B'
  Start-Sleep -Seconds 4
  $bodyCached = (Body "$Base/t3-gen" @()).Trim()
  Check 'tier3.cached-generation' ($bodyCached -eq 'A') "after rewriting lib/index.js -> '$bodyCached' (expect the cached A; same PID: $($pidBefore -eq (ScratchPid)))"
  $pidBeforeRestart = ScratchPid
  Stop-Scratch | Out-Null
  Start-Scratch
  $afterRestart = Wait-Status "$Base/t3-gen" @() '200' 30
  $pidAfterRestart = ScratchPid
  $bodyB = (Body "$Base/t3-gen" @()).Trim()
  Check 'tier3.restart-picks-up-B' ($afterRestart -and $bodyB -eq 'B') "after a boot -> '$bodyB' (expect B: lib/*.js needs a restart; PID $pidBeforeRestart -> $pidAfterRestart)"
}

# ---------------------------------------------------------------- cleanup
if (Want 'cleanup') {
  if ($script:deferDumpCheck) {
    Invoke-Action 'dumpconfig' | Out-Null
    # Harness quirk (recorded by t18): the dump lands in scratch.out, not dumpcfg.out.
    $row = (Select-String -Path $ScratchOut -Pattern 'dsh-mobile-remote' -ErrorAction SilentlyContinue | Select-Object -First 1).Line
    Check 'live.loader-ran-our-module' ($null -ne $row) "composed profile tree row: $(if ($row) { $row.Trim() } else { '<absent in scratch.out>' })"
  }
  Stop-Scratch | Out-Null
  Invoke-Action 'reset'
  Start-Sleep -Seconds 1
  Check 'cleanup.port-released' ($null -eq (ScratchPid)) "no listener on $Port"
  $net = (netstat -ano | findstr '19387')
  Check 'cleanup.19387-intact' ((($net -join ' ') -match '127\.0\.0\.1:19387') -and (($net -join ' ') -match '1428')) '19387 still owned by PID 1428, loopback only'
  Check 'cleanup.1428-starttime' ((Get-Process -Id 1428).StartTime -eq $livePidBefore) "PID 1428 StartTime unchanged ($livePidBefore)"
}

Write-Host "T6-LIVE RESULT: $script:Pass PASS / $script:Fail FAIL (profile=$Profile port=$Port)"
exit $(if ($script:Fail -eq 0) { 0 } else { 1 })

# docs/evidence/mobile — 重跑脚本（t26）
#
# 重新生成同目录下的归档证据，并自检 SHA-256 是否与 MANIFEST.txt 一致。
# 只读源转储、只写本目录；不接触 DSH 进程、不改前端 dist、不改 profile。
#
# 用法：pwsh -File EXTRACTION-RECIPE.ps1            # 重建
#       pwsh -File EXTRACTION-RECIPE.ps1 -Verify    # 只校验字节数与 SHA-256
#
# 需要 PowerShell 7（pwsh）：`Set-Content -Encoding utf8` 在 Windows PowerShell 5.1 会写入
# BOM，重跑后字节数与 SHA-256 会与 MANIFEST.txt 不一致（-Verify 会如实报 MISMATCH）。

param([switch]$Verify)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Recon = 'D:\work\dsh\pro\_recon\notes'

# 源文件（与 MANIFEST.txt 的 source 列逐字一致）
$ByteCopies = @(
  @{ Name = 'dsh-web-frontend__dist__index.html';                  Source = "$Recon\m-mobile\dsh-web-frontend__dist__index.html" },
  @{ Name = 'dsh-web-frontend__dist__assets__index-BPHePDI_.css';  Source = "$Recon\app.css" },
  @{ Name = 'dsh-client-ui-sidebar-right__lib__client.js';         Source = "$Recon\m-mobile\ui\dsh-client-ui-sidebar-right.js" }
)

if (-not $Verify) {
  foreach ($entry in $ByteCopies) {
    Copy-Item -LiteralPath $entry.Source -Destination (Join-Path $Here $entry.Name) -Force
  }

  # 派生 1：app.css 中 docs/05 引用的规则（含 R# 与字节偏移）
  $appCss = Get-Content -LiteralPath "$Recon\app.css" -Raw -Encoding utf8
  $rules = $appCss -split '(?<=\})'
  $needles = @('#root', '_button_1rv3m_2{', '_md_1rv3m_23{', '_sm_1rv3m_28{', '_item_4ub78_90{',
    '_split_6nhg2_17{', '_splitCell_6nhg2_32{', '_divider_6nhg2_39{', '_tabLayout_6nhg2_134{',
    '_tabCell_6nhg2_142,', '_tabHost_6nhg2_162{', '_tabHostBody_6nhg2_181{', '_tabLayoutDivider_6nhg2_186{',
    '_pane_6nhg2_209{', '_tabStrip_6nhg2_237{', '_stripTabs_6nhg2_257{', '_stripChrome_6nhg2_296{',
    '_tab_6nhg2_134{', '_tabClose_6nhg2_417{', '_iconButton_6nhg2_511{', '_paneBody_6nhg2_318{')
  $out = New-Object System.Collections.Generic.List[string]
  $out.Add('# docs/evidence/mobile/app.css — the rules docs/05 cites, with rule index (R#) and byte offset.')
  $out.Add('# Source: the shipped dsh-web-frontend dist stylesheet; byte copy archived beside this file as')
  $out.Add('#         dsh-web-frontend__dist__assets__index-BPHePDI_.css (the _recon dump had the same bytes).')
  $out.Add("# total rules: $($rules.Count)  bytes: $($appCss.Length)")
  $out.Add('#')
  $offset = 0
  for ($i = 1; $i -le $rules.Count; $i++) {
    $text = $rules[$i - 1]
    foreach ($needle in $needles) {
      if ($text.Contains($needle)) {
        $out.Add("## R#$i off=$offset  ~ $needle")
        $out.Add(($text -replace '\s+', ' ').Trim())
        $out.Add('')
      }
    }
    $offset += $text.Length
  }
  Set-Content -LiteralPath (Join-Path $Here 'app.css.cited-rules.txt') -Value $out -Encoding utf8

  # 派生 2/3：两个大 bundle 的逐行摘录（每段都标注源路径与源 SHA-256）
  function Write-LineExcerpt {
    param([string]$Name, [string]$Source, [int[]]$Lines)
    $content = Get-Content -LiteralPath $Source
    $hash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLower()
    $lines2 = New-Object System.Collections.Generic.List[string]
    $lines2.Add("# docs/evidence/mobile/$Name — verbatim lines docs/05 cites.")
    $lines2.Add("# Source: $Source")
    $lines2.Add("# Source SHA-256: $hash  lines: $($content.Count)")
    $lines2.Add('#')
    foreach ($line in $Lines) {
      $lines2.Add("## $(Split-Path -Leaf $Source):$line")
      $body = if ($content.Count -ge $line) { $content[$line - 1].Trim() } else { '<out of range>' }
      $lines2.Add($body.Substring(0, [Math]::Min(600, $body.Length)))
      $lines2.Add('')
    }
    Set-Content -LiteralPath (Join-Path $Here $Name) -Value $lines2 -Encoding utf8
  }
  Write-LineExcerpt -Name 'dsh-client-ui-conversation__lib__client.js.excerpt.txt' -Source "$Recon\m-mobile\ui\dsh-client-ui-conversation.js" -Lines 15797, 16325, 16329, 16338, 16227, 17172, 17838
  Write-LineExcerpt -Name 'shell-index.js.excerpt.txt' -Source "$Recon\m-mobile\shell-index.js" -Lines 126, 620482, 618635, 613754
  Write-Host 'rebuilt docs/evidence/mobile (byte copies + derived excerpts)'
}

# 自检：逐文件字节数与 SHA-256 必须与 MANIFEST.txt 的表格一致
$problems = 0
Get-Content -LiteralPath (Join-Path $Here 'MANIFEST.txt') -Encoding utf8 |
  Where-Object { $_ -match "`t" -and $_ -notmatch '^name`tbytes' } | ForEach-Object {
  $parts = $_ -split "`t"
  $name = $parts[0]
  $expectedBytes = [int]$parts[1]
  $expectedHash = $parts[2]
  $path = Join-Path $Here $name
  if (-not (Test-Path -LiteralPath $path)) { Write-Host "MISSING  $name"; $script:problems++; return }
  $actualBytes = (Get-Item -LiteralPath $path).Length
  $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
  if ($actualBytes -ne $expectedBytes -or $actualHash -ne $expectedHash) {
    Write-Host "MISMATCH $name  bytes $actualBytes/$expectedBytes  sha256 $actualHash/$expectedHash"
    $script:problems++
  }
  else { Write-Host "ok       $name  $actualBytes B" }
}
Write-Host "problems: $problems"
exit $problems

# EXTRACTION-RECIPE.ps1 — t16 终端证据提取的可复现配方（只读；不改任何 DSH 文件）
#
# 用法：powershell.exe -NoProfile -ExecutionPolicy Bypass -File EXTRACTION-RECIPE.ps1
#       （本机 harness 的 PowerShell 是 Windows PowerShell 5.1，无 pwsh.exe；
#         本文件须以 UTF-8 BOM 保存，否则 5.1 会按系统 ANSI 代码页读取中文注释而解析失败）
# 已验证：2026-10-10 用上述命令重跑，9 个产物的 SHA256 与 MANIFEST.txt 完全一致。
# 效果：把 docs\evidence\terminal\ 下的产物重新生成一遍（内容应与 MANIFEST.txt 中的 SHA256 一致）
# 依赖：D:\DSHD\resources\app.asar（只读）、D:\work\dsh\pro\_recon\asar.mjs（只读）
#
# 铁律：本脚本只做 [读取 asar] + [写入 docs\evidence\terminal\**]，
#       不触碰进程、不写 D:\DSHD、不写 profile、不起服务。

$ErrorActionPreference = 'Stop'

$asar    = 'D:\work\dsh\pro\_recon\asar.mjs'
$ev      = Join-Path $PSScriptRoot ''            # 本文件所在目录 = docs\evidence\terminal
$chunkFn = 'at-deepseek-ai__dsh-client-ui-sidebar-terminal__lib__client.terminal.js'
$chunk   = Join-Path $ev $chunkFn

# ---------------------------------------------------------------- 1. 从 asar 直取原始文件
# asar 内路径 -> 目标文件名（"\" -> "__"，作用域 @ 前缀写作 "at-"）
$map = @(
  @{ src = 'dsh\node_modules\@deepseek-ai\dsh-client-ui-sidebar-terminal\lib\client.terminal.js'; dst = 'at-deepseek-ai__dsh-client-ui-sidebar-terminal__lib__client.terminal.js' },
  @{ src = 'dsh\node_modules\@deepseek-ai\dsh-client-ui-sidebar-terminal\lib\client.js';          dst = 'at-deepseek-ai__dsh-client-ui-sidebar-terminal__lib__client.js' },
  @{ src = 'dsh\node_modules\@deepseek-ai\dsh-client-ui-sidebar-terminal\README.md';              dst = 'at-deepseek-ai__dsh-client-ui-sidebar-terminal__README.md' },
  @{ src = 'dsh\node_modules\@deepseek-ai\dsh-api-terminal-controller\lib\index.js';              dst = 'at-deepseek-ai__dsh-api-terminal-controller__lib__index.js' },
  @{ src = 'dsh\node_modules\@deepseek-ai\dsh-api-terminal-controller\lib\client.js';             dst = 'at-deepseek-ai__dsh-api-terminal-controller__lib__client.js' }
)
foreach ($m in $map) {
  node $asar save $m.src (Join-Path $ev $m.dst)
}

# ---------------------------------------------------------------- 2. 从 chunk 内联字面量派生 CSS
$lines = [IO.File]::ReadAllLines($chunk)

# 反转义 JS 字符串字面量内容（与打包器写入 head 的 textContent 完全一致）
function Unescape-JsString([string] $s) {
  [regex]::Replace($s, '\\(.)', {
      param($m)
      switch ($m.Groups[1].Value) {
        'n' { "`n" } 't' { "`t" } '"' { '"' } '\' { '\' }
        default { $m.Groups[1].Value }
      }
    })
}
# 取第 N 行（1 基）中第一个 '"' 与最后一个 '"' 之间的内容
function Get-CssLiteralAtLine([int] $n) {
  $l = $lines[$n - 1]
  $q = $l.IndexOf('"')
  $s = $l.Substring($q + 1)
  $s.Substring(0, $s.LastIndexOf('"'))
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Pretty([string] $css, [string] $exactPath, [string] $prettyPath) {
  [IO.File]::WriteAllText($exactPath,  $css,                                   $utf8NoBom)
  [IO.File]::WriteAllText($prettyPath, ($css -replace '\}', ('}' + "`n")),     $utf8NoBom)
}

# xterm.css 内联在 client.terminal.js:L13045（region 头见 L13042）
Write-Pretty (Unescape-JsString (Get-CssLiteralAtLine 13045)) `
  (Join-Path $ev 'at-xterm__xterm@6.0.0__css__xterm.css') `
  (Join-Path $ev 'at-xterm__xterm@6.0.0__css__xterm.pretty.css')

# DSH terminal.module.css 内联在 client.terminal.js:L13056（region 头见 L13055）
Write-Pretty (Unescape-JsString (Get-CssLiteralAtLine 13056)) `
  (Join-Path $ev 'at-deepseek-ai__dsh-client-ui-sidebar-terminal__src__terminal.module.css') `
  (Join-Path $ev 'at-deepseek-ai__dsh-client-ui-sidebar-terminal__src__terminal.module.pretty.css')

# ---------------------------------------------------------------- 3. 自检：列出产物与哈希
Get-ChildItem $ev -File | Where-Object { $_.Name -ne 'EXTRACTION-RECIPE.ps1' -and $_.Name -ne 'MANIFEST.txt' } |
  Sort-Object Name |
  ForEach-Object {
    "{0}`t{1}`t{2}" -f $_.Name, $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash
  }

param(
  [string]$TaskName = "QuotaLab Agent"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$agentEntry = Join-Path $projectRoot "apps\agent\dist\cli.js"
$nodeCommand = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $agentEntry -PathType Leaf)) {
  throw "Agent 尚未构建。请先在项目根目录运行 pnpm build。"
}

$action = New-ScheduledTaskAction `
  -Execute $nodeCommand `
  -Argument ('"{0}" daemon' -f $agentEntry) `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "QuotaLab privacy-safe Codex quota collector" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Output "已安装并启动计划任务：$TaskName"

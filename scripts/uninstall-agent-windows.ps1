param(
  [string]$TaskName = "QuotaLab Agent"
)

$ErrorActionPreference = "Stop"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $existing) {
  Write-Output "计划任务不存在：$TaskName"
  exit 0
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output "已移除计划任务：$TaskName（本地配置与历史游标未删除）"

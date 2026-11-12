param([string]$PostgresBin = $env:POSTGRES_BIN)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $PostgresBin) {
  $candidates = @('D:\PostgreSQL\17\bin', 'C:\Program Files\PostgreSQL\17\bin')
  $PostgresBin = $candidates | Where-Object { Test-Path (Join-Path $_ 'pg_ctl.exe') } | Select-Object -First 1
}
if (-not $PostgresBin -or -not (Test-Path (Join-Path $PostgresBin 'pg_ctl.exe'))) { throw '找不到 pg_ctl.exe。请设置 POSTGRES_BIN 指向 PostgreSQL 的 bin 目录。' }
$data = Join-Path $root '.local-db\data'
if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) { throw "本地开发数据库尚未初始化：$data" }

# PostgreSQL on Windows refuses to run as an elevated administrator.
# Register the isolated project database as a Windows service under NetworkService.
$serviceName = 'selection-tool-local-pg'
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service) {
  icacls $data /grant 'NT AUTHORITY\NETWORK SERVICE:(OI)(CI)F' /T | Out-Null
  & (Join-Path $PostgresBin 'pg_ctl.exe') register -N $serviceName -U 'NT AUTHORITY\NetworkService' -D $data -o '-p 55432 -h 127.0.0.1' -w
  if ($LASTEXITCODE -ne 0) { throw '注册本地 PostgreSQL Windows 服务失败。' }
  Set-Service -Name $serviceName -StartupType Manual
}
$service = Get-Service -Name $serviceName
Set-Service -Name $serviceName -StartupType Manual
if ($service.Status -ne 'Running') { Start-Service -Name $serviceName }
$pgIsReady = Join-Path $PostgresBin 'pg_isready.exe'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  & $pgIsReady -h 127.0.0.1 -p 55432 *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw '本地 PostgreSQL 启动失败，请检查 Windows 服务 selection-tool-local-pg。' }

$psql = Join-Path $PostgresBin 'psql.exe'
$createdb = Join-Path $PostgresBin 'createdb.exe'
$exists = & $psql -h 127.0.0.1 -p 55432 -U selection_dev -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='selection_tool_dev'"
if ($LASTEXITCODE -ne 0) { throw '无法连接本地 PostgreSQL，请检查数据库日志。' }
if ($exists.Trim() -ne '1') {
  & $createdb -h 127.0.0.1 -p 55432 -U selection_dev selection_tool_dev
  if ($LASTEXITCODE -ne 0) { throw '创建 selection_tool_dev 数据库失败。' }
}
Write-Host '本地选品开发数据库已就绪：127.0.0.1:55432/selection_tool_dev'

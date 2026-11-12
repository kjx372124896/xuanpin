param([string]$PostgresBin = $env:POSTGRES_BIN)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $PostgresBin) {
  $candidates = @('D:\PostgreSQL\17\bin', 'C:\Program Files\PostgreSQL\17\bin')
  $PostgresBin = $candidates | Where-Object { Test-Path (Join-Path $_ 'initdb.exe') } | Select-Object -First 1
}
if (-not $PostgresBin -or -not (Test-Path (Join-Path $PostgresBin 'initdb.exe'))) { throw '找不到 initdb.exe。请设置 POSTGRES_BIN 指向 PostgreSQL 的 bin 目录。' }
$data = Join-Path $root '.local-db\data'
if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $data) | Out-Null
  & (Join-Path $PostgresBin 'initdb.exe') -D $data --auth=trust --username=selection_dev --no-locale --encoding=UTF8
  if ($LASTEXITCODE -ne 0) { throw '初始化本地 PostgreSQL 数据目录失败。' }
}
& (Join-Path $PSScriptRoot 'start-local-db.ps1') -PostgresBin $PostgresBin

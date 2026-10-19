$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localEnvFile = Join-Path $repositoryRoot '.env.local'
$pgDump = 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'
$pgRestore = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'

if (-not (Test-Path -LiteralPath $pgDump)) {
  throw 'PostgreSQL 18 pg_dump.exe was not found at its standard installation path.'
}
if (-not (Test-Path -LiteralPath $pgRestore)) {
  throw 'PostgreSQL 18 pg_restore.exe was not found at its standard installation path.'
}
if (-not (Test-Path -LiteralPath $localEnvFile)) {
  throw '.env.local does not exist.'
}

$environmentLines = Get-Content -LiteralPath $localEnvFile
$connectionLine = $environmentLines | Where-Object { $_ -match '^MIGRATION_DATABASE_URL=' } | Select-Object -First 1
$connectionKey = 'MIGRATION_DATABASE_URL='
if (-not $connectionLine) {
  $connectionLine = $environmentLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  $connectionKey = 'DATABASE_URL='
}
if (-not $connectionLine) { throw 'No local PostgreSQL connection URL is configured.' }

$databaseUri = [Uri]($connectionLine.Substring($connectionKey.Length))
$connectionUser = [Uri]::UnescapeDataString($databaseUri.UserInfo.Split(':', 2)[0])
if ($databaseUri.Host -ne '127.0.0.1' -or $databaseUri.Port -ne 5432 -or
    $connectionUser -notin @('ecopulse_app', 'ecopulse_migrator') -or
    $databaseUri.AbsolutePath.TrimStart('/') -ne 'ecopulse_dev') {
  throw 'MIGRATION_DATABASE_URL does not target the expected local development database.'
}

$credentials = $databaseUri.UserInfo.Split(':', 2)
$backupDirectory = Join-Path $repositoryRoot 'backups'
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$backupFile = Join-Path $backupDirectory ("ecopulse_dev_pre_migration_{0}.dump" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))

$previous = @{
  PGHOST = $env:PGHOST
  PGPORT = $env:PGPORT
  PGUSER = $env:PGUSER
  PGPASSWORD = $env:PGPASSWORD
  PGDATABASE = $env:PGDATABASE
}
try {
  $env:PGHOST = $databaseUri.Host
  $env:PGPORT = [string]$databaseUri.Port
  $env:PGUSER = [Uri]::UnescapeDataString($credentials[0])
  $env:PGPASSWORD = [Uri]::UnescapeDataString($credentials[1])
  $env:PGDATABASE = $databaseUri.AbsolutePath.TrimStart('/')
  & $pgDump --no-password --format=custom --file=$backupFile
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupFile) -or (Get-Item -LiteralPath $backupFile).Length -eq 0) {
    throw 'pg_dump did not create a valid backup file.'
  }
  $archiveListing = & $pgRestore --list $backupFile 2>&1
  if ($LASTEXITCODE -ne 0 -or @($archiveListing).Count -eq 0) {
    throw 'pg_restore could not read the generated custom-format archive.'
  }
  $backupHash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash
  Write-Output "Backup created and readable: $backupFile"
  Write-Output "Backup SHA256: $backupHash"
} finally {
  foreach ($name in $previous.Keys) {
    Set-Item -Path "Env:$name" -Value $previous[$name] -ErrorAction SilentlyContinue
    if ($null -eq $previous[$name]) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
  }
  Remove-Variable databaseUri, credentials, connectionLine, connectionKey, connectionUser, environmentLines -ErrorAction SilentlyContinue
}

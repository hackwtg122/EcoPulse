$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localEnvFile = Join-Path $repositoryRoot '.env.local'
$grantFile = Join-Path $PSScriptRoot 'grant-local-app-permissions.sql'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

if (-not (Test-Path -LiteralPath $psql)) { throw 'PostgreSQL 18 psql.exe was not found.' }
if (-not (Test-Path -LiteralPath $localEnvFile)) { throw '.env.local does not exist.' }

$migrationLine = Get-Content -LiteralPath $localEnvFile |
  Where-Object { $_ -match '^MIGRATION_DATABASE_URL=' } |
  Select-Object -First 1
if (-not $migrationLine) { throw 'MIGRATION_DATABASE_URL is not configured.' }

$databaseUri = [Uri]($migrationLine.Substring('MIGRATION_DATABASE_URL='.Length))
$credentials = $databaseUri.UserInfo.Split(':', 2)
if ($databaseUri.Host -ne '127.0.0.1' -or $databaseUri.Port -ne 5432 -or
    [Uri]::UnescapeDataString($credentials[0]) -ne 'ecopulse_migrator' -or
    $databaseUri.AbsolutePath.TrimStart('/') -ne 'ecopulse_dev') {
  throw 'MIGRATION_DATABASE_URL does not target the expected local development database.'
}

$previousPgPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = [Uri]::UnescapeDataString($credentials[1])
  & $psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U ecopulse_migrator -d ecopulse_dev -f $grantFile
  if ($LASTEXITCODE -ne 0) { throw 'Applying runtime database permissions failed.' }
  Write-Output 'Least-privilege runtime grants were applied to ecopulse_app.'
} finally {
  $env:PGPASSWORD = $previousPgPassword
  if ($null -eq $previousPgPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  Remove-Variable databaseUri, credentials, migrationLine -ErrorAction SilentlyContinue
}

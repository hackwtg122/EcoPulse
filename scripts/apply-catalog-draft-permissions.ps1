$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localEnvFile = Join-Path $repositoryRoot '.env.local'
$grantFile = Join-Path $PSScriptRoot 'grant-catalog-draft-permissions.sql'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (-not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $localEnvFile)) { throw 'PostgreSQL 18 or local environment file is missing.' }
$migrationLine = Get-Content -LiteralPath $localEnvFile | Where-Object { $_ -match '^MIGRATION_DATABASE_URL=' } | Select-Object -First 1
if (-not $migrationLine) { throw 'MIGRATION_DATABASE_URL is not configured.' }
$databaseUri = [Uri]($migrationLine.Substring('MIGRATION_DATABASE_URL='.Length))
$credentials = $databaseUri.UserInfo.Split(':', 2)
if ($credentials.Count -ne 2 -or $databaseUri.Scheme -ne 'postgresql' -or $databaseUri.Host -ne '127.0.0.1' -or $databaseUri.Port -ne 5432 -or [Uri]::UnescapeDataString($credentials[0]) -ne 'ecopulse_migrator' -or $databaseUri.AbsolutePath -ne '/ecopulse_dev') { throw 'Refusing non-local or non-migrator database target.' }
$previousPgPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = [Uri]::UnescapeDataString($credentials[1])
  & $psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U ecopulse_migrator -d ecopulse_dev -f $grantFile
  if ($LASTEXITCODE -ne 0) { throw 'Catalog draft privilege grant failed.' }
  Write-Output 'Catalog draft-only column INSERT grants applied.'
} finally {
  if ($null -eq $previousPgPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previousPgPassword }
  Remove-Variable databaseUri, credentials, migrationLine -ErrorAction SilentlyContinue
}
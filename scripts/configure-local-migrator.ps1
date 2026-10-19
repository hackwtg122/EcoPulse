$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localEnvFile = Join-Path $repositoryRoot '.env.local'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

if (-not (Test-Path -LiteralPath $psql)) {
  throw 'PostgreSQL 18 psql.exe was not found at its standard installation path.'
}
if (-not (Test-Path -LiteralPath $localEnvFile)) {
  throw '.env.local does not exist. Configure DATABASE_URL first.'
}
if (Select-String -LiteralPath $localEnvFile -Pattern '^MIGRATION_DATABASE_URL=' -Quiet) {
  throw 'MIGRATION_DATABASE_URL already exists; refusing to overwrite it.'
}

$securePassword = Read-Host 'Enter the ecopulse_migrator password (hidden)' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}

try {
  $previousPgPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $password
    $identity = & $psql -X -w -h 127.0.0.1 -p 5432 -U ecopulse_migrator -d ecopulse_dev -tA -c "SELECT current_user, current_database(), pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()" 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL migrator authentication or ownership check failed: $identity"
    }
    if (($identity | Out-String).Trim() -ne 'ecopulse_migrator|ecopulse_dev|ecopulse_migrator') {
      throw 'The migrator is not the owner of ecopulse_dev; no configuration was written.'
    }
  } finally {
    $env:PGPASSWORD = $previousPgPassword
  }

  $encodedPassword = [Uri]::EscapeDataString($password)
  $migrationUrl = "postgresql://ecopulse_migrator:$encodedPassword@127.0.0.1:5432/ecopulse_dev"
  [System.IO.File]::AppendAllText($localEnvFile, "MIGRATION_DATABASE_URL=$migrationUrl`n", [System.Text.UTF8Encoding]::new($false))
  Write-Output 'Migrator login and database ownership verified. MIGRATION_DATABASE_URL was added to ignored .env.local.'
} finally {
  Remove-Variable password, encodedPassword, migrationUrl, securePassword -ErrorAction SilentlyContinue
}

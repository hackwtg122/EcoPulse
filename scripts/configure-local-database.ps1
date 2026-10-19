$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localEnvFile = Join-Path $repositoryRoot '.env.local'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

if (-not (Test-Path -LiteralPath $psql)) {
  throw 'PostgreSQL 18 psql.exe was not found at its standard installation path.'
}
if (Test-Path -LiteralPath $localEnvFile) {
  throw '.env.local already exists; refusing to overwrite local configuration.'
}
if ($env:DATABASE_URL) {
  throw 'DATABASE_URL is already set in this terminal; inspect it before creating .env.local.'
}

$securePassword = Read-Host 'Enter the ecopulse_app password (hidden)' -AsSecureString
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
    $identity = & $psql -X -w -h 127.0.0.1 -p 5432 -U ecopulse_app -d ecopulse_dev -tA -c 'SELECT current_user, current_database()' 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL authentication or connection failed: $identity"
    }
    if (($identity | Out-String).Trim() -ne 'ecopulse_app|ecopulse_dev') {
      throw 'PostgreSQL returned an unexpected user or database; no configuration was written.'
    }
  } finally {
    $env:PGPASSWORD = $previousPgPassword
  }

  $encodedPassword = [Uri]::EscapeDataString($password)
  $databaseUrl = "postgresql://ecopulse_app:$encodedPassword@127.0.0.1:5432/ecopulse_dev"
  $contents = "DATABASE_URL=$databaseUrl`n"
  $stream = [System.IO.File]::Open($localEnvFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try {
    $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
    try {
      $writer.Write($contents)
    } finally {
      $writer.Dispose()
    }
  } finally {
    $stream.Dispose()
  }

  Write-Output 'PostgreSQL login verified. .env.local was created and is ignored by Git.'
} finally {
  Remove-Variable password, encodedPassword, databaseUrl, contents, securePassword -ErrorAction SilentlyContinue
}

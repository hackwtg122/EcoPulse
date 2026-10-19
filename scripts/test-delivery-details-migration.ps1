$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$postgresBin = 'C:\Program Files\PostgreSQL\18\bin'
$initDb = Join-Path $postgresBin 'initdb.exe'
$pgCtl = Join-Path $postgresBin 'pg_ctl.exe'
$postgres = Join-Path $postgresBin 'postgres.exe'
$pgIsReady = Join-Path $postgresBin 'pg_isready.exe'
$psql = Join-Path $postgresBin 'psql.exe'
$temporaryRoot = Join-Path $repositoryRoot 'tmp'
$dataDirectory = Join-Path $temporaryRoot 'ecopulse-test-pg'
$passwordFile = Join-Path $temporaryRoot 'ecopulse-test-password.tmp'
$logFile = Join-Path $temporaryRoot 'ecopulse-test-postgres.log'
$testPort = 55432

foreach ($executable in @($initDb, $pgCtl, $postgres, $pgIsReady, $psql)) {
  if (-not (Test-Path -LiteralPath $executable)) {
    throw "Required PostgreSQL 18 executable is missing: $executable"
  }
}
if (Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue) {
  throw "Port $testPort is already in use; refusing to start the isolated test server."
}

$resolvedRepository = [System.IO.Path]::GetFullPath($repositoryRoot)
$resolvedDataDirectory = [System.IO.Path]::GetFullPath($dataDirectory)
if (-not $resolvedDataDirectory.StartsWith(($resolvedRepository + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe temporary PostgreSQL data path.'
}

New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
if (Test-Path -LiteralPath $dataDirectory) {
  Remove-Item -LiteralPath $dataDirectory -Recurse -Force
}
Remove-Item -LiteralPath $passwordFile, $logFile -Force -ErrorAction SilentlyContinue

$passwordBytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($passwordBytes)
$testPassword = [Convert]::ToHexString($passwordBytes).ToLowerInvariant()
[System.IO.File]::WriteAllText($passwordFile, $testPassword, [System.Text.UTF8Encoding]::new($false))

$previous = @{
  PGPASSWORD = $env:PGPASSWORD
  TEST_DATABASE_URL = $env:TEST_DATABASE_URL
}
$serverStarted = $false
try {
  & $initDb -D $dataDirectory -U ecopulse_test_admin -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed for the isolated test cluster.' }

  Add-Content -LiteralPath (Join-Path $dataDirectory 'postgresql.conf') -Value @"
listen_addresses = '127.0.0.1'
port = $testPort
max_connections = 20
"@

  $serverProcess = Start-Process -FilePath $postgres `
    -ArgumentList @('-D', $dataDirectory) `
    -RedirectStandardOutput $logFile -RedirectStandardError ("$logFile.error") `
    -PassThru -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & $pgIsReady -h 127.0.0.1 -p $testPort -q
    if ($LASTEXITCODE -eq 0) {
      $serverStarted = $true
      break
    }
    if ($serverProcess.HasExited) {
      throw 'The isolated PostgreSQL test server exited during startup.'
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $serverStarted) { throw 'The isolated PostgreSQL test server did not become ready.' }

  $env:PGPASSWORD = $testPassword
  & $psql -X -w -h 127.0.0.1 -p $testPort -U ecopulse_test_admin -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE ecopulse_test;' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create ecopulse_test in the isolated cluster.' }

  $encodedPassword = [Uri]::EscapeDataString($testPassword)
  $env:TEST_DATABASE_URL = "postgresql://ecopulse_test_admin:$encodedPassword@127.0.0.1:$testPort/ecopulse_test"
  & node --experimental-strip-types (Join-Path $PSScriptRoot 'verify-delivery-details-migration.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'The delivery details migration verification failed.' }

  & node --experimental-strip-types (Join-Path $PSScriptRoot 'verify-delivery-details-backend.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'The delivery details backend verification failed.' }
} finally {
  if ($serverStarted) {
    & $pgCtl -D $dataDirectory -m fast -w stop | Out-Null
    if ($LASTEXITCODE -ne 0 -and $null -ne $serverProcess -and -not $serverProcess.HasExited) {
      Stop-Process -Id $serverProcess.Id -Force
      Write-Warning 'The isolated PostgreSQL test server required a forced stop.'
    }
  }
  foreach ($name in $previous.Keys) {
    if ($null -eq $previous[$name]) {
      Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path "Env:$name" -Value $previous[$name]
    }
  }
  Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $dataDirectory) {
    $verifiedDataDirectory = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $dataDirectory).Path)
    if (-not $verifiedDataDirectory.StartsWith(($resolvedRepository + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to remove an unsafe PostgreSQL test directory.'
    }
    Remove-Item -LiteralPath $verifiedDataDirectory -Recurse -Force
  }
  Remove-Item -LiteralPath $logFile, ("$logFile.error") -Force -ErrorAction SilentlyContinue
  Remove-Variable testPassword, encodedPassword, passwordBytes -ErrorAction SilentlyContinue
}

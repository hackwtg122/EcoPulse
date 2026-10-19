$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$initDb = Join-Path $bin 'initdb.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$pgIsReady = Join-Path $bin 'pg_isready.exe'
$postgres = Join-Path $bin 'postgres.exe'
$psql = Join-Path $bin 'psql.exe'
$pgRestore = Join-Path $bin 'pg_restore.exe'
$port = 55435
$envFile = Join-Path $root '.env.local'
$backup = Get-ChildItem -LiteralPath (Join-Path $root 'backups') -Filter 'ecopulse_dev_pre_migration_*.dump' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw 'Backup missing' }
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  throw 'Isolated restore port is occupied'
}
$line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^MIGRATION_DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw 'MIGRATION_DATABASE_URL missing' }
$source = [Uri]($line.Substring('MIGRATION_DATABASE_URL='.Length))
$user = [Uri]::UnescapeDataString($source.UserInfo.Split(':',2)[0])
if ($source.Host -ne '127.0.0.1' -or $source.Port -ne 5432 -or
    $source.AbsolutePath -ne '/ecopulse_dev' -or $user -ne 'ecopulse_migrator') {
  throw 'Source is not local ecopulse_dev migrator'
}
$archive = & $pgRestore --list $backup.FullName
if ($LASTEXITCODE -ne 0) { throw 'Backup archive unreadable' }
$temporaryRoot = Join-Path $root 'tmp'
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
$work = Join-Path $temporaryRoot ('backup-restore-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$data = Join-Path $work 'pgdata'
$passwordFile = Join-Path $work 'password.tmp'
$listFile = Join-Path $work 'restore.list'
$logFile = Join-Path $work 'postgres.log'
$archive | Where-Object { $_ -notmatch '^\d+;.* SCHEMA - public ' } |
  Set-Content -LiteralPath $listFile -Encoding utf8NoBOM
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$password = [Convert]::ToHexString($bytes).ToLowerInvariant()
[System.IO.File]::WriteAllText($passwordFile, $password, [System.Text.UTF8Encoding]::new($false))
$previous = @{}
foreach ($name in @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE')) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$started = $false
try {
  $env:PGHOST = '127.0.0.1'
  $env:PGPORT = '5432'
  $env:PGUSER = $user
  $env:PGPASSWORD = [Uri]::UnescapeDataString($source.UserInfo.Split(':',2)[1])
  $env:PGDATABASE = 'ecopulse_dev'
  $query = "SELECT json_build_object('users',(SELECT count(*) FROM users),'scans',(SELECT count(*) FROM scans),'deliveries',(SELECT count(*) FROM deliveries),'centers',(SELECT count(*) FROM delivery_points),'active_centers',(SELECT count(*) FROM delivery_points WHERE active),'rewards',(SELECT count(*) FROM rewards),'redemptions',(SELECT count(*) FROM redemptions),'movements',(SELECT count(*) FROM point_movements),'migrations',(SELECT array_agg(hash ORDER BY created_at) FROM drizzle.__drizzle_migrations))::text"
  $sourceState = (& $psql -X -A -t -q -w -v ON_ERROR_STOP=1 -c $query | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $sourceState) { throw 'Source state query failed' }
  & $initDb -D $data -U ecopulse_restore_admin -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Isolated initdb failed' }
  Add-Content -LiteralPath (Join-Path $data 'postgresql.conf') -Value "listen_addresses = '127.0.0.1'`nport = $port`nmax_connections = 12"
  $server = Start-Process -FilePath $postgres -ArgumentList @('-D', $data) -RedirectStandardOutput $logFile -RedirectStandardError (Join-Path $work 'postgres.error.log') -WindowStyle Hidden -PassThru
  for ($i=0; $i -lt 80; $i++) {
    & $pgIsReady -h 127.0.0.1 -p $port -q
    if ($LASTEXITCODE -eq 0) { $started = $true; break }
    if ($server.HasExited) { throw 'Isolated PostgreSQL exited during startup' }
    Start-Sleep -Milliseconds 250
  }
  if (-not $started) { throw 'Isolated PostgreSQL not ready' }
  $env:PGPORT = [string]$port
  $env:PGUSER = 'ecopulse_restore_admin'
  $env:PGPASSWORD = $password
  $env:PGDATABASE = 'postgres'
  & $psql -X -w -v ON_ERROR_STOP=1 -c 'CREATE DATABASE ecopulse_restore;' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Isolated database creation failed' }
  $env:PGDATABASE = 'ecopulse_restore'
  & $pgRestore --no-owner --no-acl --exit-on-error --use-list=$listFile --dbname=ecopulse_restore $backup.FullName
  if ($LASTEXITCODE -ne 0) { throw 'Isolated restore failed' }
  $restoredState = (& $psql -X -A -t -q -w -v ON_ERROR_STOP=1 -c $query | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $restoredState -ne $sourceState) { throw 'Restored state differs from source' }
  $state = $restoredState | ConvertFrom-Json
  Write-Output ("Backup restored and matched in isolated PostgreSQL: users={0}, scans={1}, deliveries={2}, centers={3}, active_centers={4}, rewards={5}, redemptions={6}, movements={7}, migrations={8}" -f
    $state.users,$state.scans,$state.deliveries,$state.centers,$state.active_centers,$state.rewards,$state.redemptions,$state.movements,$state.migrations.Count)
} finally {
  if ($started) {
    & $pgCtl -D $data -m fast -w stop | Out-Null
    if ($LASTEXITCODE -ne 0 -and $server -and -not $server.HasExited) {
      Stop-Process -Id $server.Id -Force
    }
  }
  foreach ($name in $previous.Keys) {
    if ($null -eq $previous[$name]) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item -Path "Env:$name" -Value $previous[$name] }
  }
  $resolvedRoot = [System.IO.Path]::GetFullPath($temporaryRoot) + [System.IO.Path]::DirectorySeparatorChar
  $resolvedWork = [System.IO.Path]::GetFullPath($work)
  if (-not $resolvedWork.StartsWith($resolvedRoot,[System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing unsafe cleanup path'
  }
  Remove-Item -LiteralPath $resolvedWork -Recurse -Force
  Remove-Variable password, bytes -ErrorAction SilentlyContinue
}
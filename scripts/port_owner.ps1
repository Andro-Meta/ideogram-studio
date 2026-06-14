# Identify what (if anything) is listening on a TCP port, for run.bat.
# Emits exactly one line:
#   FREE                      - nothing is listening
#   OURS|<pid>                - our uvicorn studio (cmdline has uvicorn + main:app)
#   OTHER|<pid>|<proc-name>   - some unrelated program holding the port
#
# Kept in a script (not inline in the .bat) because embedding a quote-heavy
# PowerShell one-liner inside cmd's `for /f` backticks mangles the quoting.
param([int]$Port = 8000)

$ErrorActionPreference = 'SilentlyContinue'

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1
if (-not $conn) { 'FREE'; return }

$procId = $conn.OwningProcess
$proc   = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
$cmd    = [string]$proc.CommandLine

if ($cmd -match 'uvicorn' -and $cmd -match 'main:app') {
    "OURS|$procId"
} else {
    $name = if ($proc.Name) { $proc.Name } else { 'unknown' }
    "OTHER|$procId|$name"
}

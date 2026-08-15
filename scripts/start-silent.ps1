$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$EnvFile = Join-Path $RootDir ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)\s*=\s*(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

$LogDir = Join-Path $RootDir "data"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir "tunnel.log"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = Join-Path $RootDir "bin\tunnel-client.exe"
$psi.Arguments = "run --profile openpc-mcp"
$psi.WorkingDirectory = $RootDir
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$psi.EnvironmentVariables["CONTROL_PLANE_API_KEY"] = $env:CONTROL_PLANE_API_KEY
$psi.EnvironmentVariables["CONTROL_PLANE_TUNNEL_ID"] = $env:CONTROL_PLANE_TUNNEL_ID

$proc = [System.Diagnostics.Process]::Start($psi)
if ($proc) {
    $stdOutTask = [System.Threading.Tasks.Task]::Run({
        $outWriter = [System.IO.File]::AppendText($LogFile)
        while (-not $proc.HasExited -or -not $proc.StandardOutput.EndOfStream) {
            $line = $proc.StandardOutput.ReadLine()
            if ($line) {
                $outWriter.WriteLine($line)
                $outWriter.Flush()
            }
        }
        $outWriter.Close()
    })
    $proc.WaitForExit()
}

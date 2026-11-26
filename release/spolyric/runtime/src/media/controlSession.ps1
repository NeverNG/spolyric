param(
    [string]$Action = 'toggle',
    [long]$SeekMs = 0,
    [switch]$Serve
)

# src/media/controlSession.ps1
# Sends transport commands to the local Spotify client through SMTC.
# `-Serve` keeps one process alive and reads one JSON request per line on stdin, so a button press costs
# a line instead of a PowerShell start-up; without it the script does one command and exits.
# ASCII only: Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI.

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($operation, $resultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
    $netTask = $asTask.Invoke($null, @($operation))
    # A session that is changing can leave the operation pending; never hang the caller for it.
    if (-not $netTask.Wait(4000)) { throw 'the media session did not answer in time' }
    $netTask.Result
}

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ($managerType::RequestAsync()) $managerType

function Find-SpotifySession() {
    foreach ($candidate in $manager.GetSessions()) {
        if ($candidate.SourceAppUserModelId -match 'Spotify') { return $candidate }
    }
    return $null
}

function Invoke-Control($command, $seekTo) {
    $session = Find-SpotifySession
    if ($null -eq $session) {
        return [ordered]@{ ok = $false; reason = 'no-spotify-session' }
    }
    $ok = $false
    try {
        switch ($command) {
            'play'   { $ok = Await ($session.TryPlayAsync()) ([bool]) }
            'pause'  { $ok = Await ($session.TryPauseAsync()) ([bool]) }
            'toggle' { $ok = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
            'next'   { $ok = Await ($session.TrySkipNextAsync()) ([bool]) }
            'prev'   { $ok = Await ($session.TrySkipPreviousAsync()) ([bool]) }
            # TryChangePlaybackPositionAsync takes 100-nanosecond ticks.
            'seek'   { $ok = Await ($session.TryChangePlaybackPositionAsync([int64]$seekTo * 10000)) ([bool]) }
            default  { return [ordered]@{ ok = $false; reason = 'unknown-action' } }
        }
    } catch {
        return [ordered]@{ ok = $false; reason = $_.Exception.Message }
    }
    return [ordered]@{ ok = $ok; status = [string]$session.GetPlaybackInfo().PlaybackStatus }
}

if ($Serve) {
    # A StreamReader on the standard input handle reads one line per request; [Console]::In can report
    # end-of-input after the first request once a WinRT operation has run.
    $reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput())
    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line) { break }
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $request = $line | ConvertFrom-Json
            $result = Invoke-Control ([string]$request.action) ([long]$request.seekMs)
        } catch {
            $result = [ordered]@{ ok = $false; reason = 'bad-request' }
        }
        $result | ConvertTo-Json -Compress
        [Console]::Out.Flush()
    }
    exit 0
}

$result = Invoke-Control $Action $SeekMs
$result | ConvertTo-Json -Compress

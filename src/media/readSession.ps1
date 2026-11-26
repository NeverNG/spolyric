param(
    [int]$IntervalMs = 1500
)

# src/media/readSession.ps1
# Reads Windows' media session (SMTC) and prints one JSON line per sample.
# Spolyric starts this process from src/media/session.ts.
#
# Spotify's free accounts cannot use the Web API (the app owner needs Premium), but the local
# Spotify client reports what is playing to SMTC, which any local program may read - the same
# route Lyricify takes for free accounts.
#
# This file is deliberately ASCII-only: Windows PowerShell 5.1 reads a .ps1 without a BOM as ANSI,
# so non-ASCII comments can be mis-decoded and even swallow the following newline.

# Always write UTF-8, whatever the console code page is (936 would otherwise give GBK and the
# parent would read the Chinese titles as mojibake).
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
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mediaType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ($managerType::RequestAsync()) $managerType

while ($true) {
    try {
        $session = $manager.GetCurrentSession()
        if ($null -eq $session) {
            '{"session":null}'
            Start-Sleep -Milliseconds $IntervalMs
            continue
        }
        $properties = Await ($session.TryGetMediaPropertiesAsync()) $mediaType
        $timeline = $session.GetTimelineProperties()
        $playback = $session.GetPlaybackInfo()
        $playing = ([int]$playback.PlaybackStatus -eq 4)

        # Timeline.Position is the position at LastUpdatedTime; Spotify refreshes it every 1-3
        # seconds. While playing, add the time since then to get "now".
        $positionMs = [double]$timeline.Position.TotalMilliseconds
        if ($playing) {
            $elapsed = ([DateTimeOffset]::Now - $timeline.LastUpdatedTime).TotalMilliseconds
            if ($elapsed -gt 0 -and $elapsed -lt 7000) { $positionMs += $elapsed }
        }
        $positionMs = [int][Math]::Max(0, [Math]::Round($positionMs))

        $record = [ordered]@{
            session    = 'current'
            app        = [string]$session.SourceAppUserModelId
            title      = [string]$properties.Title
            artist     = [string]$properties.Artist
            album      = [string]$properties.AlbumTitle
            durationMs = [int][Math]::Round($timeline.EndTime.TotalMilliseconds)
            positionMs = $positionMs
            playing    = $playing
            status     = [int]$playback.PlaybackStatus
        }
        $record | ConvertTo-Json -Compress
    } catch {
        $message = $_.Exception.Message -replace '\\', '\\\\' -replace '"', '\"'
        '{"session":null,"error":"' + $message + '"}'
    }
    Start-Sleep -Milliseconds $IntervalMs
}
